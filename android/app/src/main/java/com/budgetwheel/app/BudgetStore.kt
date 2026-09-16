package com.budgetwheel.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale
import kotlin.math.max
import kotlin.math.round

/**
 * One live budget, shared by the WebView app and the home-screen widget.
 *
 * Storage
 *   SharedPreferences "budgetwheel" / "budget_json"
 *   Same payload the JS bridge writes: { state, user, updatedAt, baseUpdatedAt }
 *
 * Sync
 *   App persist → writeBudgetJson → merge widget-only purchases → notify widgets
 *   Widget purchase → addPurchase → BudgetSync pulls the WebView
 *   Extra Funds slice → addExtraFunds (kind "in" activity, leftover envelope)
 *   mergeBudgetJson keeps widget txs whose createdAt is after the app's baseUpdatedAt
 *   jsonTime() reads JS numbers that do not fit in JSONObject.getLong
 *
 * Live numbers
 *   The home-screen widget is always this calendar month, even if the app
 *   is showing a quarter or year. The wheel is one ring sized by envelopes
 *   (and spend when a slice is over). Extra Funds is leftover take-home,
 *   never a second income source, never assigned budget spending.
 */
class BudgetStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // -----------------------------------------------------------------------
    // Shared JSON
    // -----------------------------------------------------------------------

    fun writeBudgetJson(json: String) {
        synchronized(ioLock) {
            prefs.edit().putString(KEY_BUDGET, mergeBudgetJson(readBudgetJson(), json)).commit()
        }
    }

    fun readBudgetJson(): String? = prefs.getString(KEY_BUDGET, null)

    fun watchBudget(listener: android.content.SharedPreferences.OnSharedPreferenceChangeListener) {
        prefs.registerOnSharedPreferenceChangeListener(listener)
    }

    fun unwatchBudget(listener: android.content.SharedPreferences.OnSharedPreferenceChangeListener) {
        prefs.unregisterOnSharedPreferenceChangeListener(listener)
    }

    fun bundle(): Bundle? {
        val raw = readBudgetJson() ?: return null
        return try {
            val obj = JSONObject(raw)
            val state = obj.optJSONObject("state") ?: obj
            Bundle(state = state)
        } catch (_: Exception) {
            null
        }
    }

    /** True after onboarding. Named for the widget empty-state, not a login. */
    fun onboarded(): Boolean {
        return bundle()?.state?.optBoolean("onboardingComplete") == true
    }

    fun widgetUnlocked(): Boolean = prefs.getBoolean(KEY_WIDGET, false)

    fun setWidgetUnlocked(owned: Boolean) {
        prefs.edit().putBoolean(KEY_WIDGET, owned).apply()
    }

    // -----------------------------------------------------------------------
    // Per-widget chrome (phase, pad, selected slice, chart). Not the budget.
    // -----------------------------------------------------------------------

    fun widgetPhase(id: Int): String = prefs.getString(phaseKey(id), PHASE_WHEEL) ?: PHASE_WHEEL

    fun widgetPad(id: Int): String = prefs.getString(padKey(id), "") ?: ""

    fun widgetAmount(id: Int): Double = java.lang.Double.longBitsToDouble(prefs.getLong(amountKey(id), 0L))

    fun selectedSlice(id: Int): String? = prefs.getString(selKey(id), null)?.ifBlank { null }

    fun setSelectedSlice(id: Int, sliceId: String?) {
        prefs.edit().putString(selKey(id), sliceId ?: "").apply()
    }

    fun chartMode(id: Int): String {
        val stored = prefs.getString(chartKey(id), null)
        if (stored == "bars" || stored == "wheel") return stored
        val fromState = bundle()?.state?.optString("homeChart")
        return if (fromState == "bars") "bars" else "wheel"
    }

    fun toggleChartMode(id: Int) {
        val next = if (chartMode(id) == "bars") "wheel" else "bars"
        prefs.edit().putString(chartKey(id), next).apply()
    }

    fun setWidgetPhase(id: Int, phase: String, pad: String? = null, amount: Double? = null) {
        val e = prefs.edit().putString(phaseKey(id), phase)
        if (pad != null) e.putString(padKey(id), pad)
        if (amount != null) e.putLong(amountKey(id), java.lang.Double.doubleToRawLongBits(amount))
        if (phase == PHASE_WHEEL) {
            e.putString(padKey(id), "")
            e.putLong(amountKey(id), 0L)
        }
        e.apply()
    }

    fun resetWidgetFlow(id: Int) {
        setWidgetPhase(id, PHASE_WHEEL)
    }

    fun clearWidget(id: Int) {
        prefs.edit()
            .remove(phaseKey(id))
            .remove(padKey(id))
            .remove(amountKey(id))
            .remove(selKey(id))
            .remove(chartKey(id))
            .apply()
    }

    // -----------------------------------------------------------------------
    // Widget purchases write the same transaction list the app reads
    // -----------------------------------------------------------------------

    fun addPurchase(categoryId: String, amount: Double) {
        if (categoryId == EXTRA_FUNDS_ID) {
            addExtraFunds(amount)
            return
        }
        synchronized(ioLock) {
            val raw = readBudgetJson() ?: return
            val root = JSONObject(raw)
            val state = root.optJSONObject("state") ?: root
            val txs = state.optJSONArray("transactions") ?: JSONArray()
            val now = System.currentTimeMillis()
            val tx = JSONObject()
            tx.put("id", "tx_w_${now}_${(0..999_999).random()}")
            tx.put("categoryId", categoryId)
            tx.put("amount", roundCents(amount))
            tx.put("createdAt", now)
            tx.put("kind", "out")
            txs.put(tx)
            state.put("transactions", txs)
            state.put("updatedAt", now)
            if (root.has("state")) {
                root.put("state", state)
                root.put("updatedAt", now)
                prefs.edit().putString(KEY_BUDGET, root.toString()).commit()
            } else {
                prefs.edit().putString(KEY_BUDGET, state.toString()).commit()
            }
        }
        BudgetSync.notifyApp()
    }

    /** Extra cash this month on Extra Funds. Same as src/store.ts addExtraFunds. */
    fun addExtraFunds(amount: Double) {
        synchronized(ioLock) {
            val add = roundCents(amount)
            if (add <= 0) return
            val raw = readBudgetJson() ?: return
            val root = JSONObject(raw)
            val state = root.optJSONObject("state") ?: root
            val income = state.optJSONObject("income") ?: return
            peelAddedFunds(income, state)
            val txs = state.optJSONArray("transactions") ?: JSONArray()
            val now = System.currentTimeMillis()
            val tx = JSONObject()
            tx.put("id", "tx_w_${now}_${(0..999_999).random()}")
            tx.put("categoryId", EXTRA_FUNDS_ID)
            tx.put("amount", add)
            tx.put("createdAt", now)
            tx.put("kind", "in")
            txs.put(tx)
            state.put("transactions", txs)
            state.put("income", income)
            syncExtraFundsLeftover(state, income)
            state.put("updatedAt", now)
            if (root.has("state")) {
                root.put("state", state)
                root.put("updatedAt", now)
                prefs.edit().putString(KEY_BUDGET, root.toString()).commit()
            } else {
                prefs.edit().putString(KEY_BUDGET, state.toString()).commit()
            }
        }
        BudgetSync.notifyApp()
    }

    // -----------------------------------------------------------------------
    // Live slices — same membership and order as src/store.ts wheelCategories
    // -----------------------------------------------------------------------

    data class Slice(
        val id: String,
        val name: String,
        val color: String,
        val budgeted: Double,
        val spent: Double,
        val envelope: Double,
        val order: Int = 0,
    )

    data class Bundle(
        val state: JSONObject,
    )

    /** Categories that appear on the wheel / graph (budgeted or already spent). */
    fun slices(): List<Slice> = paintOutOfBudgetColors(categoryRows(onlyOnWheel = true))

    /** Same membership as the app wheel: unused color for no-envelope spend. */
    private fun paintOutOfBudgetColors(rows: List<Slice>): List<Slice> {
        val used = rows
            .filter { it.id == EXTRA_FUNDS_ID || it.envelope > 0.009 }
            .map { it.color.uppercase(Locale.US) }
            .toMutableSet()
        return rows.map { slice ->
            val out = slice.id != EXTRA_FUNDS_ID && slice.envelope <= 0.009 && slice.spent > 0.009
            if (!out) {
                slice
            } else if (used.add(slice.color.uppercase(Locale.US))) {
                slice
            } else {
                val next = WheelRenderer.unusedDisplayColor(used)
                used.add(next.uppercase(Locale.US))
                slice.copy(color = next)
            }
        }
    }

    /** Purchase picker: every visible category except the caller filters Extra Funds. */
    fun visibleCategories(): List<Slice> = categoryRows(onlyOnWheel = false)

    private fun categoryRows(onlyOnWheel: Boolean): List<Slice> {
        val state = bundle()?.state ?: return emptyList()
        val cats = state.optJSONArray("categories") ?: return emptyList()
        val spent = spentMap(state)
        val extraIn = extraInThisMonth(state)
        val takeHome = takeHomeThisMonth(state)
        var assigned = 0.0
        for (i in 0 until cats.length()) {
            val row = cats.optJSONObject(i) ?: continue
            if (row.optBoolean("hidden")) continue
            if (row.optString("id") == EXTRA_FUNDS_ID) continue
            assigned += row.optDouble("budgeted", 0.0)
        }
        val extraEnvelope = roundCents(takeHome + extraIn - assigned)
        val out = ArrayList<Slice>()
        for (i in 0 until cats.length()) {
            val c = cats.optJSONObject(i) ?: continue
            if (c.optBoolean("hidden")) continue
            val id = c.optString("id")
            val budgeted = c.optDouble("budgeted", 0.0)
            val used = spent[id] ?: 0.0
            if (onlyOnWheel && id != EXTRA_FUNDS_ID && budgeted <= 0.009 && used <= 0.009) continue
            val envelope = if (id == EXTRA_FUNDS_ID) extraEnvelope else roundCents(budgeted)
            out.add(
                Slice(
                    id = id,
                    name = c.optString("name"),
                    color = c.optString("color", "#F0C94D"),
                    budgeted = budgeted,
                    spent = used,
                    envelope = envelope,
                    order = c.optInt("order", i),
                ),
            )
        }
        return withExtraFundsPool(out).sortedWith(compareByDescending<Slice> { it.budgeted }.thenBy { it.name.lowercase(Locale.US) })
    }

    private fun withExtraFundsPool(rows: List<Slice>): List<Slice> {
        val extraOut = rows.find { it.id == EXTRA_FUNDS_ID }?.spent ?: 0.0
        val oob = rows.filter { it.id != EXTRA_FUNDS_ID && it.envelope <= 0.009 }.sumOf { it.spent }
        val lost = roundCents(extraOut + oob)
        return rows.map { row ->
            if (row.id != EXTRA_FUNDS_ID) row else row.copy(spent = lost)
        }
    }

    fun periodTitle(): String {
        val now = Calendar.getInstance()
        val month = now.getDisplayName(Calendar.MONTH, Calendar.SHORT, Locale.US) ?: ""
        return "$month ${now.get(Calendar.YEAR)}"
    }

    fun periodWord(): String = "month"

    fun assignedSlices(): List<Slice> = slices().filter { it.id != EXTRA_FUNDS_ID && it.envelope > 0.009 }

    fun budgetLeft(): Double {
        val assigned = assignedSlices()
        return roundCents(assigned.sumOf { it.envelope } - assigned.sumOf { it.spent })
    }

    /** Unspent assigned budgets plus Extra Funds remaining (after out-of-budget). */
    fun moneyLeft(): Double {
        val extra = slices().find { it.id == EXTRA_FUNDS_ID }
        val extraLeft = extra?.let { roundCents(it.envelope - it.spent) } ?: 0.0
        return roundCents(budgetLeft() + extraLeft)
    }

    fun themePref(): String = bundle()?.state?.optString("theme", "dark") ?: "dark"

    fun isLightTheme(context: Context): Boolean {
        val pref = themePref()
        if (pref == "light") return true
        if (pref == "dark") return false
        val night = context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK
        return night == android.content.res.Configuration.UI_MODE_NIGHT_NO
    }

    fun outOfBudgetSpend(): Double =
        slices().filter { it.id != EXTRA_FUNDS_ID && it.envelope <= 0.009 }.sumOf { it.spent }

    /** Assigned spend plus out-of-budget. Extra Funds is not spending. */
    fun totalSpend(): Double = roundCents(assignedSlices().sumOf { it.spent } + outOfBudgetSpend())

    fun wheelCenter(selectedId: String? = null): WheelRenderer.Center {
        val slices = slices()
        val selected = selectedId?.let { id -> slices.find { it.id == id } }
        if (selected != null) {
            val left = selected.envelope - selected.spent
            val extra = selected.id == EXTRA_FUNDS_ID
            return WheelRenderer.Center(
                label = selected.name,
                value = money(left),
                sub = if (extra) {
                    "${money(selected.spent)} lost of ${money(selected.envelope)}"
                } else {
                    "${money(selected.spent)} of ${money(selected.envelope)}"
                },
                negative = left < 0,
            )
        }
        val assigned = assignedSlices()
        val spent = totalSpend()
        val budget = assigned.sumOf { it.envelope }
        val income = income()
        return WheelRenderer.Center(
            label = "Income",
            value = money(income),
            sub = "${money(spent)} spent of ${money(budget)} budget",
            negative = false,
        )
    }

    fun monthlyIncome(): Double {
        return bundle()?.state?.optJSONObject("income")?.optDouble("monthlyTakeHome", 0.0) ?: 0.0
    }

    /** Take-home plus Extra Funds cash-in this month. Shown in the wheel center. */
    fun income(): Double {
        val state = bundle()?.state ?: return 0.0
        return roundCents(takeHomeThisMonth(state) + extraInThisMonth(state))
    }

    fun extraFundsAdded(): Double {
        val state = bundle()?.state ?: return 0.0
        return extraInThisMonth(state)
    }

    companion object {
        const val PREFS = "budgetwheel"
        const val KEY_BUDGET = "budget_json"
        const val KEY_WIDGET = "widget_unlock"
        const val PHASE_WHEEL = "wheel"
        const val PHASE_AMOUNT = "amount"
        const val PHASE_CATEGORY = "category"
        const val EXTRA_FUNDS_ID = "cat_extra"
        const val ADDED_FUNDS_ID = "inc_added_funds"

        private val ioLock = Any()

        fun phaseKey(id: Int) = "phase_$id"
        fun padKey(id: Int) = "pad_$id"
        fun amountKey(id: Int) = "amount_$id"
        fun selKey(id: Int) = "sel_$id"
        fun chartKey(id: Int) = "chart_$id"

        /**
         * JS stores times as IEEE doubles. JSONObject.optLong() on those
         * values used to return 0 and drop the purchase from the period.
         */
        fun jsonTime(obj: JSONObject, key: String): Long {
            if (!obj.has(key) || obj.isNull(key)) return 0L
            return try {
                obj.getLong(key)
            } catch (_: Exception) {
                obj.optDouble(key, 0.0).toLong()
            }
        }

        /**
         * Incoming app persist wins for categories / income / history.
         * Transactions from the existing widget copy are kept when they
         * were created after [baseUpdatedAt] (the stamp the app last wrote).
         */
        fun mergeBudgetJson(existingRaw: String?, incomingRaw: String): String {
            val incoming = try {
                JSONObject(incomingRaw)
            } catch (_: Exception) {
                return existingRaw ?: incomingRaw
            }
            if (existingRaw.isNullOrBlank()) return incoming.toString()
            val existing = try {
                JSONObject(existingRaw)
            } catch (_: Exception) {
                return incoming.toString()
            }
            val inUser = incoming.optJSONObject("user")?.optString("id").orEmpty()
            val exUser = existing.optJSONObject("user")?.optString("id").orEmpty()
            if (inUser.isNotEmpty() && exUser.isNotEmpty() && inUser != exUser) {
                return incoming.toString()
            }
            val inState = incoming.optJSONObject("state") ?: incoming
            val exState = existing.optJSONObject("state") ?: existing
            // JS Date.now() is a double. optLong() reads that as 0 and would
            // fall back to "now", wiping every widget purchase. 0 means reset:
            // take incoming txs only, do not resurrect prefs-only rows.
            val baseAt = jsonTime(incoming, "baseUpdatedAt")
            val mergedTx = JSONArray()
            val seen = HashSet<String>()
            fun addFrom(arr: JSONArray?, onlyAfter: Long) {
                if (arr == null) return
                for (i in 0 until arr.length()) {
                    val tx = arr.optJSONObject(i) ?: continue
                    val id = tx.optString("id")
                    if (id.isBlank() || !seen.add(id)) continue
                    if (onlyAfter > 0L && jsonTime(tx, "createdAt") <= onlyAfter) continue
                    mergedTx.put(tx)
                }
            }
            addFrom(inState.optJSONArray("transactions"), 0L)
            if (baseAt > 0L) addFrom(exState.optJSONArray("transactions"), baseAt)
            inState.put("transactions", mergedTx)
            if (incoming.has("state")) incoming.put("state", inState)
            return incoming.toString()
        }

        fun roundCents(v: Double): Double = round(v * 100.0) / 100.0

        fun money(amount: Double): String {
            val abs = kotlin.math.abs(amount)
            val formatted = String.format(Locale.US, "$%,.2f", abs)
            return if (amount < 0) "−$formatted" else formatted
        }

        fun formatPct(value: Double): String {
            val digits = if (value > 0 && value < 10) 1 else 0
            return String.format(Locale.US, "%.${digits}f%%", value)
        }

        fun padDisplay(raw: String): String {
            if (raw.isEmpty()) return "$0"
            if (raw.endsWith(".")) return "$$raw"
            val n = raw.toDoubleOrNull() ?: return "$0"
            return if (raw.contains(".")) {
                val dec = raw.substringAfter(".").length
                String.format(Locale.US, "$%,.${dec.coerceAtMost(2)}f", n)
            } else {
                String.format(Locale.US, "$%,.0f", n)
            }
        }

        fun parsePad(raw: String): Double {
            if (raw.isEmpty() || raw == ".") return 0.0
            return roundCents(raw.toDoubleOrNull() ?: 0.0)
        }

        fun appendPad(current: String, key: String): String {
            if (key == "back") return if (current.isEmpty()) "" else current.dropLast(1)
            if (key == ".") {
                if (current.contains(".")) return current
                return if (current.isEmpty()) "0." else "$current."
            }
            if (key.length != 1 || key[0] !in '0'..'9') return current
            if (current == "0") return key
            if (current.contains(".")) {
                val dec = current.substringAfter(".")
                if (dec.length >= 2) return current
            }
            if (current.replace(".", "").length >= 8) return current
            return current + key
        }

        private fun spentMap(state: JSONObject): Map<String, Double> {
            val map = HashMap<String, Double>()
            val txs = state.optJSONArray("transactions") ?: return map
            val now = Calendar.getInstance()
            for (i in 0 until txs.length()) {
                val tx = txs.optJSONObject(i) ?: continue
                if (tx.optString("kind") == "in") continue
                if (!inThisMonth(jsonTime(tx, "createdAt"), now)) continue
                val id = tx.optString("categoryId")
                map[id] = (map[id] ?: 0.0) + tx.optDouble("amount")
            }
            return map
        }

        /** JS weekday 0=Sunday. Count hits in the current calendar month. */
        private fun weekdayCountInMonth(jsWeekday: Int): Int {
            val cal = Calendar.getInstance()
            val year = cal.get(Calendar.YEAR)
            val month = cal.get(Calendar.MONTH)
            cal.set(year, month, 1)
            val firstDow = cal.get(Calendar.DAY_OF_WEEK)
            val target = jsWeekday + 1
            val offset = (target - firstDow + 7) % 7
            val firstHit = 1 + offset
            val lastDate = cal.getActualMaximum(Calendar.DAY_OF_MONTH)
            if (firstHit > lastDate) return 0
            return (lastDate - firstHit) / 7 + 1
        }

        /** Hourly sources with a payday use this month's weekday count. Salary is unchanged. */
        private fun takeHomeThisMonth(state: JSONObject): Double {
            val income = state.optJSONObject("income") ?: return 0.0
            val sources = income.optJSONArray("sources")
            if (sources == null || sources.length() == 0) {
                return roundCents(income.optDouble("monthlyTakeHome"))
            }
            var sum = 0.0
            for (i in 0 until sources.length()) {
                val source = sources.optJSONObject(i) ?: continue
                if (source.optString("id") == ADDED_FUNDS_ID) continue
                val monthly = source.optDouble("monthlyTakeHome")
                val type = source.optString("type")
                val pay = if (source.has("payWeekday") && !source.isNull("payWeekday")) {
                    source.optInt("payWeekday", -1)
                } else {
                    -1
                }
                sum += if (type == "hourly" && pay in 0..6) {
                    monthly * 12.0 / 52.0 * weekdayCountInMonth(pay)
                } else {
                    monthly
                }
            }
            return roundCents(sum)
        }

        private fun extraInThisMonth(state: JSONObject): Double {
            val txs = state.optJSONArray("transactions") ?: return 0.0
            val now = Calendar.getInstance()
            var sum = 0.0
            for (i in 0 until txs.length()) {
                val tx = txs.optJSONObject(i) ?: continue
                if (tx.optString("kind") != "in") continue
                if (tx.optString("categoryId") != EXTRA_FUNDS_ID) continue
                if (!inThisMonth(jsonTime(tx, "createdAt"), now)) continue
                sum += tx.optDouble("amount")
            }
            return roundCents(sum)
        }

        /** Drop the retired Extra Funds income source; keep its cash as Extra Funds activity. */
        private fun peelAddedFunds(income: JSONObject, state: JSONObject) {
            val sources = income.optJSONArray("sources") ?: return
            var addedAmt = 0.0
            val next = JSONArray()
            for (i in 0 until sources.length()) {
                val source = sources.optJSONObject(i) ?: continue
                if (source.optString("id") == ADDED_FUNDS_ID) {
                    addedAmt = roundCents(source.optDouble("monthlyTakeHome"))
                    continue
                }
                next.put(source)
            }
            if (addedAmt <= 0.009) return
            income.put("sources", next)
            income.put("monthlyTakeHome", roundCents(max(0.0, income.optDouble("monthlyTakeHome") - addedAmt)))
            income.put("monthlyGross", roundCents(max(0.0, income.optDouble("monthlyGross") - addedAmt)))
            val txs = state.optJSONArray("transactions") ?: JSONArray()
            var existingIn = 0.0
            for (i in 0 until txs.length()) {
                val tx = txs.optJSONObject(i) ?: continue
                if (tx.optString("kind") == "in" && tx.optString("categoryId") == EXTRA_FUNDS_ID) {
                    existingIn += tx.optDouble("amount")
                }
            }
            val missing = roundCents(addedAmt - existingIn)
            if (missing > 0.009) {
                val now = System.currentTimeMillis()
                val tx = JSONObject()
                tx.put("id", "tx_w_${now}_${(0..999_999).random()}")
                tx.put("categoryId", EXTRA_FUNDS_ID)
                tx.put("amount", missing)
                tx.put("createdAt", now)
                tx.put("kind", "in")
                txs.put(tx)
            }
            state.put("transactions", txs)
        }

        private fun syncExtraFundsLeftover(state: JSONObject, income: JSONObject) {
            val monthly = income.optDouble("monthlyTakeHome")
            val cats = state.optJSONArray("categories") ?: return
            var assigned = 0.0
            for (i in 0 until cats.length()) {
                val cat = cats.optJSONObject(i) ?: continue
                if (cat.optString("id") == EXTRA_FUNDS_ID || cat.optBoolean("hidden")) continue
                assigned += cat.optDouble("budgeted", 0.0)
            }
            for (i in 0 until cats.length()) {
                val cat = cats.optJSONObject(i) ?: continue
                if (cat.optString("id") != EXTRA_FUNDS_ID) continue
                cat.put("budgeted", roundCents(max(0.0, monthly - assigned)))
                cat.put("hidden", false)
            }
        }

        private fun inThisMonth(createdAt: Long, now: Calendar): Boolean {
            if (createdAt <= 0L) return false
            val cal = Calendar.getInstance()
            cal.timeInMillis = createdAt
            return cal.get(Calendar.YEAR) == now.get(Calendar.YEAR) &&
                cal.get(Calendar.MONTH) == now.get(Calendar.MONTH)
        }
    }
}

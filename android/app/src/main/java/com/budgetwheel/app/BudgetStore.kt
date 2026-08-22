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
 *   Extra Funds slice → addExtraFunds (side income, leftover envelope)
 *   mergeBudgetJson keeps widget txs whose createdAt is after the app's baseUpdatedAt
 *   jsonTime() reads JS numbers that do not fit in JSONObject.getLong
 *
 * Live numbers
 *   The home-screen widget is always this calendar month, even if the app
 *   is showing a quarter or year. 100% of the wheel is monthly take-home.
 *   Extra Funds is leftover income, never assigned budget spending.
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

    /** Add leftover cash to Extra Funds. Same as src/store.ts addExtraFunds. */
    fun addExtraFunds(amount: Double) {
        synchronized(ioLock) {
            val add = roundCents(amount)
            if (add <= 0) return
            val raw = readBudgetJson() ?: return
            val root = JSONObject(raw)
            val state = root.optJSONObject("state") ?: root
            val income = state.optJSONObject("income") ?: return
            val sources = income.optJSONArray("sources") ?: JSONArray()
            if (sources.length() == 0) {
                val primary = JSONObject()
                primary.put("id", "inc_primary")
                primary.put("kind", "primary")
                primary.put("type", income.optString("type", "salary"))
                if (income.has("salaryPeriod")) primary.put("salaryPeriod", income.optString("salaryPeriod"))
                if (income.has("salaryAmount")) primary.put("salaryAmount", income.optDouble("salaryAmount"))
                if (income.has("hourlyWage")) primary.put("hourlyWage", income.optDouble("hourlyWage"))
                if (income.has("hoursPerWeek")) primary.put("hoursPerWeek", income.optDouble("hoursPerWeek"))
                primary.put("monthlyGross", income.optDouble("monthlyGross"))
                primary.put("monthlyTakeHome", income.optDouble("monthlyTakeHome"))
                primary.put("estimatedTaxAnnual", income.optDouble("estimatedTaxAnnual"))
                sources.put(primary)
            }
            var found = false
            for (i in 0 until sources.length()) {
                val source = sources.optJSONObject(i) ?: continue
                if (source.optString("id") != ADDED_FUNDS_ID) continue
                source.put("kind", "side")
                source.put("type", "side")
                source.put("monthlyTakeHome", roundCents(source.optDouble("monthlyTakeHome") + add))
                source.put("monthlyGross", roundCents(source.optDouble("monthlyGross") + add))
                found = true
                break
            }
            if (!found) {
                val source = JSONObject()
                source.put("id", ADDED_FUNDS_ID)
                source.put("kind", "side")
                source.put("type", "side")
                source.put("monthlyGross", add)
                source.put("monthlyTakeHome", add)
                source.put("estimatedTaxAnnual", 0)
                sources.put(source)
            }
            income.put("sources", sources)
            income.put("monthlyTakeHome", roundCents(income.optDouble("monthlyTakeHome") + add))
            income.put("monthlyGross", roundCents(income.optDouble("monthlyGross") + add))
            state.put("income", income)
            val monthly = income.optDouble("monthlyTakeHome")
            val cats = state.optJSONArray("categories")
            if (cats != null) {
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
            val now = System.currentTimeMillis()
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
        val out = ArrayList<Slice>()
        for (i in 0 until cats.length()) {
            val c = cats.optJSONObject(i) ?: continue
            if (c.optBoolean("hidden")) continue
            val id = c.optString("id")
            val budgeted = c.optDouble("budgeted", 0.0)
            val used = spent[id] ?: 0.0
            if (onlyOnWheel && id != EXTRA_FUNDS_ID && budgeted <= 0.009 && used <= 0.009) continue
            out.add(
                Slice(
                    id = id,
                    name = c.optString("name"),
                    color = c.optString("color", "#F0C94D"),
                    budgeted = budgeted,
                    spent = used,
                    envelope = roundCents(budgeted),
                    order = c.optInt("order", i),
                ),
            )
        }
        return out.sortedWith(compareByDescending<Slice> { it.budgeted }.thenBy { it.name.lowercase(Locale.US) })
    }

    fun periodTitle(): String {
        val now = Calendar.getInstance()
        val month = now.getDisplayName(Calendar.MONTH, Calendar.SHORT, Locale.US) ?: ""
        return "$month ${now.get(Calendar.YEAR)}"
    }

    fun periodWord(): String = "month"

    fun assignedSlices(): List<Slice> = slices().filter { it.id != EXTRA_FUNDS_ID && it.envelope > 0.009 }

    fun outOfBudgetSpend(): Double =
        slices().filter { it.id != EXTRA_FUNDS_ID && it.envelope <= 0.009 }.sumOf { it.spent }

    fun wheelCenter(selectedId: String? = null): WheelRenderer.Center {
        val slices = slices()
        val selected = selectedId?.let { id -> slices.find { it.id == id } }
        if (selected != null) {
            val left = selected.envelope - selected.spent
            return WheelRenderer.Center(
                label = selected.name,
                value = money(left),
                sub = "${money(selected.spent)} of ${money(selected.envelope)}",
                negative = left < 0,
            )
        }
        val assigned = assignedSlices()
        val spent = assigned.sumOf { it.spent }
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

    /** Monthly take-home. The widget wheel is always 100% = this month's income. */
    fun income(): Double = monthlyIncome()

    companion object {
        const val PREFS = "budgetwheel"
        const val KEY_BUDGET = "budget_json"
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
                if (!inThisMonth(jsonTime(tx, "createdAt"), now)) continue
                val id = tx.optString("categoryId")
                map[id] = (map[id] ?: 0.0) + tx.optDouble("amount")
            }
            return map
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

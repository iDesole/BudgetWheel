package com.budgetwheel.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import com.budgetwheel.app.BudgetStore
import com.budgetwheel.app.MainActivity
import com.budgetwheel.app.R
import com.budgetwheel.app.WheelRenderer
import java.util.Locale
import kotlin.math.max

/**
 * Home-screen AppWidget. Always this month's wheel or graph, not spending history.
 *
 * Budget numbers come from [BudgetStore] (same JSON the app persists).
 * Per-widget chrome (pad, selected slice, chart mode) lives beside that JSON.
 * Tapping a slice on the bitmap is not possible; chevrons cycle instead.
 */
class WheelWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { render(context, manager, it) }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        id: Int,
        newOptions: android.os.Bundle,
    ) {
        render(context, manager, id)
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        val store = BudgetStore(context)
        ids.forEach { store.clearWidget(it) }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action != ACTION) return
        val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
        val store = BudgetStore(context)
        val op = intent.getStringExtra(EXTRA_OP) ?: return
        when (op) {
            OP_BUY -> store.setWidgetPhase(id, BudgetStore.PHASE_AMOUNT, pad = "")
            OP_CANCEL -> {
                val phase = store.widgetPhase(id)
                if (phase == BudgetStore.PHASE_CATEGORY) {
                    store.setWidgetPhase(id, BudgetStore.PHASE_AMOUNT)
                } else {
                    store.setWidgetPhase(id, BudgetStore.PHASE_WHEEL)
                }
            }
            OP_KEY -> {
                val next = BudgetStore.appendPad(store.widgetPad(id), intent.getStringExtra(EXTRA_KEY) ?: "")
                store.setWidgetPhase(id, BudgetStore.PHASE_AMOUNT, pad = next)
            }
            OP_NEXT -> {
                val amount = BudgetStore.parsePad(store.widgetPad(id))
                if (amount <= 0) return
                // A selected slice logs here — same as the in-app "I purchased" flow.
                val selected = store.selectedSlice(id)
                val target = selected?.let { sid -> store.slices().find { it.id == sid } }
                if (target != null) {
                    if (target.id == BudgetStore.EXTRA_FUNDS_ID) {
                        store.addExtraFunds(amount)
                    } else {
                        store.addPurchase(target.id, amount)
                    }
                    store.setSelectedSlice(id, target.id)
                    store.setWidgetPhase(id, BudgetStore.PHASE_WHEEL)
                    refreshAll(context)
                    return
                }
                store.setWidgetPhase(id, BudgetStore.PHASE_CATEGORY, amount = amount)
            }
            OP_CAT -> {
                val cat = intent.getStringExtra(EXTRA_CAT) ?: return
                val amount = store.widgetAmount(id)
                if (amount > 0 && cat.isNotBlank()) {
                    store.addPurchase(cat, amount)
                    store.setSelectedSlice(id, cat)
                    store.setWidgetPhase(id, BudgetStore.PHASE_WHEEL)
                    refreshAll(context)
                    return
                }
            }
            OP_CYCLE -> {
                val dir = if (intent.getStringExtra(EXTRA_KEY) == "-1") -1 else 1
                val ids = store.slices().map { it.id }
                if (ids.isEmpty()) return
                val selected = store.selectedSlice(id)
                val current = if (selected != null) ids.indexOf(selected) else if (dir > 0) -1 else 0
                val idx = if (current < 0 && dir < 0) 0 else current
                val next = ids[(idx + dir + ids.size) % ids.size]
                store.setSelectedSlice(id, next)
            }
            OP_CLEAR -> {
                store.setSelectedSlice(id, null)
                if (patchGraphSelection(context, store, id)) return
            }
            OP_CHART -> {
                store.toggleChartMode(id)
                if (store.chartMode(id) == "bars") store.setSelectedSlice(id, null)
            }
            OP_GRAPH -> {
                val cat = intent.getStringExtra(EXTRA_CAT)
                store.setSelectedSlice(id, if (cat != null && cat == store.selectedSlice(id)) null else cat)
                if (patchGraphSelection(context, store, id)) return
            }
        }
        val manager = AppWidgetManager.getInstance(context)
        render(context, manager, id)
    }

    companion object {
        const val ACTION = "com.budgetwheel.app.widget.ACTION"
        const val EXTRA_OP = "op"
        const val EXTRA_KEY = "key"
        const val EXTRA_CAT = "cat"
        const val OP_BUY = "buy"
        const val OP_CANCEL = "cancel"
        const val OP_KEY = "key"
        const val OP_NEXT = "next"
        const val OP_CAT = "cat"
        const val OP_CYCLE = "cycle"
        const val OP_CLEAR = "clear"
        const val OP_CHART = "chart"
        const val OP_GRAPH = "graph"

        fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, WheelWidgetProvider::class.java))
            ids.forEach { render(context, manager, it) }
        }

        fun resetFlows(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val store = BudgetStore(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, WheelWidgetProvider::class.java))
            ids.forEach { id ->
                store.resetWidgetFlow(id)
                render(context, manager, id)
            }
        }

        fun render(context: Context, manager: AppWidgetManager, id: Int) {
            val store = BudgetStore(context)
            val size = widgetSize(manager, id)
            val views = if (size != "full") {
                compactViews(context, store, manager, id, wide = size == "wide")
            } else when (store.widgetPhase(id)) {
                BudgetStore.PHASE_AMOUNT -> padViews(context, store, id)
                BudgetStore.PHASE_CATEGORY -> catViews(context, store, id)
                else -> wheelViews(context, store, id)
            }
            manager.updateAppWidget(id, views)
            if (size == "full" && store.widgetPhase(id) == BudgetStore.PHASE_CATEGORY) {
                manager.notifyAppWidgetViewDataChanged(id, R.id.widget_cat_list)
            }
            if (size == "full" && store.widgetPhase(id) == BudgetStore.PHASE_WHEEL && store.chartMode(id) == "bars") {
                manager.notifyAppWidgetViewDataChanged(id, R.id.widget_graph_list)
            }
        }

        /** 2×2 compact, 4×2 wide, otherwise the full wheel / graph / purchase pad. */
        private fun widgetSize(manager: AppWidgetManager, id: Int): String {
            val opts = manager.getAppWidgetOptions(id)
            val minW = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250)
            val minH = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 250)
            return when {
                minH < 160 && minW < 180 -> "compact"
                minH < 160 -> "wide"
                else -> "full"
            }
        }

        private fun widgetLight(context: Context, store: BudgetStore): Boolean = store.isLightTheme(context)

        private fun onInk(context: Context, store: BudgetStore): Int =
            context.getColor(if (widgetLight(context, store)) R.color.bw_on_light else R.color.bw_on)

        private fun softInk(context: Context, store: BudgetStore): Int =
            context.getColor(if (widgetLight(context, store)) R.color.bw_soft_light else R.color.bw_soft)

        private fun applyChrome(context: Context, store: BudgetStore, views: RemoteViews) {
            val light = widgetLight(context, store)
            views.setInt(
                R.id.widget_root,
                "setBackgroundResource",
                if (light) R.drawable.widget_bg_light else R.drawable.widget_bg,
            )
        }

        private fun errInk(context: Context, store: BudgetStore): Int =
            context.getColor(if (widgetLight(context, store)) R.color.bw_error_light else R.color.bw_error)

        private fun primaryInk(context: Context, store: BudgetStore): Int =
            context.getColor(if (widgetLight(context, store)) R.color.bw_primary_light else R.color.bw_primary)

        private fun statBg(store: BudgetStore, context: Context): Int =
            if (widgetLight(context, store)) R.drawable.widget_graph_stat_light else R.drawable.widget_graph_stat

        private fun tintIcon(views: RemoteViews, id: Int, color: Int) {
            views.setInt(id, "setColorFilter", color)
        }

        private fun compactViews(
            context: Context,
            store: BudgetStore,
            manager: AppWidgetManager,
            id: Int,
            wide: Boolean,
        ): RemoteViews {
            val views = RemoteViews(
                context.packageName,
                if (wide) R.layout.widget_compact_wide else R.layout.widget_compact,
            )
            applyChrome(context, store, views)
            val ready = store.onboarded()
            val left = store.budgetLeft()
            val over = left < 0
            val on = context.getColor(if (widgetLight(context, store)) R.color.bw_on_light else R.color.bw_on)
            val soft = context.getColor(if (widgetLight(context, store)) R.color.bw_soft_light else R.color.bw_soft)
            val err = errInk(context, store)
            views.setTextViewText(R.id.widget_left, if (ready) BudgetStore.money(if (over) -left else left) else "")
            views.setTextColor(R.id.widget_left, if (over) err else on)
            views.setTextViewText(
                R.id.widget_left_lbl,
                context.getString(if (over) R.string.widget_stat_over else R.string.widget_left_month),
            )
            views.setTextColor(R.id.widget_left_lbl, soft)
            views.setOnClickPendingIntent(R.id.widget_root, openApp(context, id))
            views.setOnClickPendingIntent(R.id.widget_wheel, openApp(context, id))
            if (ready) {
                views.setImageViewBitmap(
                    R.id.widget_wheel,
                    WheelRenderer.draw(
                        store.slices(),
                        compactWheelPx(context, manager, id, wide),
                        store.wheelCenter(null),
                        null,
                        showCenter = false,
                        light = widgetLight(context, store),
                    ),
                )
                bindTicks(context, store, views)
            }
            return views
        }

        private fun bindTicks(context: Context, store: BudgetStore, views: RemoteViews) {
            val ids = intArrayOf(
                R.id.widget_tick_0,
                R.id.widget_tick_1,
                R.id.widget_tick_2,
                R.id.widget_tick_3,
                R.id.widget_tick_4,
                R.id.widget_tick_5,
                R.id.widget_tick_6,
                R.id.widget_tick_7,
            )
            val slices = store.assignedSlices().take(ids.size)
            ids.forEachIndexed { i, viewId ->
                if (i < slices.size) {
                    views.setViewVisibility(viewId, View.VISIBLE)
                    views.setImageViewBitmap(viewId, WidgetBitmaps.swatch(context, slices[i].color))
                } else {
                    views.setViewVisibility(viewId, View.GONE)
                }
            }
        }

        private fun compactWheelPx(context: Context, manager: AppWidgetManager, id: Int, wide: Boolean): Int {
            val opts = manager.getAppWidgetOptions(id)
            val minW = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 110)
            val minH = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110)
            val wheelDp = if (wide) {
                kotlin.math.min(minH - 16, minW / 2).coerceIn(72, 160)
            } else {
                kotlin.math.min(minW, minH).minus(36).coerceIn(72, 140)
            }
            val px = TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                wheelDp.toFloat(),
                context.resources.displayMetrics,
            ).toInt()
            return (px * 2).coerceIn(240, 640)
        }

        private fun wheelViews(context: Context, store: BudgetStore, id: Int): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_wheel)
            applyChrome(context, store, views)
            val ready = store.onboarded()
            val selected = store.selectedSlice(id)
            val graph = ready && store.chartMode(id) == "bars"
            val hasSlices = ready && store.slices().isNotEmpty()
            views.setViewVisibility(R.id.widget_wheel_wrap, if (ready && !graph) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.widget_graph_list_wrap, if (graph) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.widget_graph_list, if (graph) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.widget_graph_detail, if (graph) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.widget_empty, if (ready) View.GONE else View.VISIBLE)
            views.setViewVisibility(R.id.widget_buy, if (ready) View.VISIBLE else View.GONE)
            views.setTextViewText(
                R.id.widget_buy,
                context.getString(
                    if (selected == BudgetStore.EXTRA_FUNDS_ID) R.string.widget_add_funds else R.string.widget_buy,
                ),
            )
            views.setViewVisibility(R.id.widget_chart_toggle, if (ready) View.VISIBLE else View.INVISIBLE)
            views.setViewVisibility(R.id.widget_cycle_left, if (hasSlices && !graph) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.widget_cycle_right, if (hasSlices && !graph) View.VISIBLE else View.GONE)
            views.setTextViewText(R.id.widget_left, if (ready) store.periodTitle() else "")
            views.setTextColor(R.id.widget_left, onInk(context, store))
            views.setTextColor(R.id.widget_brand, primaryInk(context, store))
            views.setTextColor(R.id.widget_empty, softInk(context, store))
            tintIcon(views, R.id.widget_chart_toggle, softInk(context, store))
            tintIcon(views, R.id.widget_cycle_left, softInk(context, store))
            tintIcon(views, R.id.widget_cycle_right, softInk(context, store))
            views.setOnClickPendingIntent(R.id.widget_open_app, openApp(context, id))
            views.setImageViewResource(R.id.widget_chart_toggle, if (graph) R.drawable.ic_wheel else R.drawable.ic_graph)
            views.setContentDescription(
                R.id.widget_chart_toggle,
                context.getString(if (graph) R.string.widget_show_wheel else R.string.widget_graph),
            )
            if (ready) {
                views.setOnClickPendingIntent(R.id.widget_chart_toggle, action(context, id, OP_CHART, 7))
                views.setOnClickPendingIntent(R.id.widget_buy, action(context, id, OP_BUY, 1))
                if (graph) {
                    bindGraphDetail(context, store, views, selected)
                    val svc = Intent(context, GraphRemoteService::class.java)
                    svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                    svc.data = Uri.parse("widget://graph/$id")
                    views.setRemoteAdapter(R.id.widget_graph_list, svc)
                    views.setPendingIntentTemplate(R.id.widget_graph_list, action(context, id, OP_GRAPH, 8, mutable = true))
                } else {
                    views.setImageViewBitmap(
                        R.id.widget_wheel,
                        WheelRenderer.draw(
                            store.slices(),
                            wheelSizePx(context, AppWidgetManager.getInstance(context), id),
                            store.wheelCenter(selected),
                            selected,
                            light = widgetLight(context, store),
                        ),
                    )
                    bindWheelCorner(context, store, views)
                    views.setOnClickPendingIntent(R.id.widget_wheel, action(context, id, OP_CLEAR, 9))
                    views.setOnClickPendingIntent(R.id.widget_cycle_left, action(context, id, OP_CYCLE, 5, "1"))
                    views.setOnClickPendingIntent(R.id.widget_cycle_right, action(context, id, OP_CYCLE, 6, "-1"))
                }
            } else {
                views.setOnClickPendingIntent(R.id.widget_root, openApp(context, id))
            }
            return views
        }

        /** Update the graph header only — notifying the list would jump the scroll. */
        private fun patchGraphSelection(context: Context, store: BudgetStore, id: Int): Boolean {
            if (store.widgetPhase(id) != BudgetStore.PHASE_WHEEL) return false
            if (store.chartMode(id) != "bars") return false
            val views = RemoteViews(context.packageName, R.layout.widget_wheel)
            bindGraphDetail(context, store, views, store.selectedSlice(id))
            AppWidgetManager.getInstance(context).partiallyUpdateAppWidget(id, views)
            return true
        }

        private fun bindWheelCorner(
            context: Context,
            store: BudgetStore,
            views: RemoteViews,
        ) {
            val assigned = store.assignedSlices()
            val left = assigned.sumOf { it.envelope } - assigned.sumOf { it.spent }
            val over = left < 0
            val oob = store.outOfBudgetSpend()
            val chip = statBg(store, context)
            views.setInt(R.id.widget_wheel_corner, "setBackgroundResource", chip)
            views.setInt(R.id.widget_wheel_left_wrap, "setBackgroundResource", chip)
            views.setTextColor(R.id.widget_wheel_oob_val, onInk(context, store))
            views.setTextColor(R.id.widget_wheel_oob_lbl, softInk(context, store))
            views.setTextColor(R.id.widget_wheel_left_lbl, softInk(context, store))
            views.setViewVisibility(R.id.widget_wheel_corner, View.VISIBLE)
            views.setViewVisibility(R.id.widget_wheel_left_wrap, View.VISIBLE)
            views.setTextViewText(R.id.widget_wheel_oob_val, BudgetStore.money(oob))
            views.setTextColor(
                R.id.widget_wheel_oob_val,
                if (oob > 0.009) errInk(context, store) else onInk(context, store),
            )
            views.setTextViewText(
                R.id.widget_wheel_left_val,
                BudgetStore.money(if (over) -left else left),
            )
            views.setTextColor(
                R.id.widget_wheel_left_val,
                if (over) errInk(context, store) else onInk(context, store),
            )
            views.setTextViewText(
                R.id.widget_wheel_left_lbl,
                context.getString(if (over) R.string.widget_stat_over else R.string.widget_stat_left),
            )
        }

        private fun bindGraphDetail(
            context: Context,
            store: BudgetStore,
            views: RemoteViews,
            selectedId: String?,
        ) {
            views.setViewVisibility(R.id.widget_graph_detail, View.VISIBLE)
            views.setInt(
                R.id.widget_graph_detail,
                "setBackgroundResource",
                if (widgetLight(context, store)) R.drawable.widget_bar_card_light else R.drawable.widget_bar_card,
            )
            val chip = statBg(store, context)
            views.setInt(R.id.widget_stat_budgeted_box, "setBackgroundResource", chip)
            views.setInt(R.id.widget_stat_spent_box, "setBackgroundResource", chip)
            views.setInt(R.id.widget_stat_left_box, "setBackgroundResource", chip)
            views.setTextColor(R.id.widget_stat_budgeted, onInk(context, store))
            views.setTextColor(R.id.widget_stat_budgeted_lbl, softInk(context, store))
            views.setTextColor(R.id.widget_stat_spent_lbl, softInk(context, store))
            views.setTextColor(R.id.widget_stat_left_lbl, softInk(context, store))
            views.setTextColor(R.id.widget_graph_oob_lbl, softInk(context, store))
            val slices = store.slices()
            val slice = selectedId?.let { id -> slices.find { it.id == id } }
            val envelope: Double
            val spent: Double
            val budgeted: Double
            val left: Double
            var outOfBudget = 0.0
            if (slice != null) {
                views.setViewVisibility(R.id.widget_graph_swatch, View.VISIBLE)
                views.setViewVisibility(R.id.widget_graph_income, View.GONE)
                views.setViewVisibility(R.id.widget_graph_oob_head, View.GONE)
                views.setImageViewBitmap(R.id.widget_graph_swatch, WidgetBitmaps.swatch(context, slice.color))
                views.setTextViewText(R.id.widget_graph_name, slice.name)
                views.setTextViewTextSize(R.id.widget_graph_name, TypedValue.COMPLEX_UNIT_SP, 15f)
                views.setTextColor(R.id.widget_graph_name, onInk(context, store))
                views.setTextViewTextSize(R.id.widget_graph_share, TypedValue.COMPLEX_UNIT_SP, 12f)
                views.setTextColor(R.id.widget_graph_share, softInk(context, store))
                envelope = slice.envelope
                spent = slice.spent
                budgeted = slice.budgeted
                left = envelope - spent
            } else {
                views.setViewVisibility(R.id.widget_graph_swatch, View.GONE)
                views.setViewVisibility(R.id.widget_graph_income, View.GONE)
                views.setViewVisibility(R.id.widget_graph_oob_head, View.VISIBLE)
                views.setTextViewText(R.id.widget_graph_name, context.getString(R.string.widget_income_title))
                views.setTextViewTextSize(R.id.widget_graph_name, TypedValue.COMPLEX_UNIT_SP, 12f)
                views.setTextColor(R.id.widget_graph_name, softInk(context, store))
                views.setTextViewText(R.id.widget_graph_share, BudgetStore.money(store.income()))
                views.setTextViewTextSize(R.id.widget_graph_share, TypedValue.COMPLEX_UNIT_SP, 16f)
                views.setTextColor(R.id.widget_graph_share, onInk(context, store))
                val assigned = store.assignedSlices()
                envelope = assigned.sumOf { it.envelope }
                outOfBudget = store.outOfBudgetSpend()
                spent = store.totalSpend()
                budgeted = assigned.sumOf { it.budgeted }
                left = envelope - assigned.sumOf { it.spent }
            }
            val income = store.monthlyIncome()
            if (slice != null) {
                val share = if (slice.id == BudgetStore.EXTRA_FUNDS_ID) {
                    context.getString(R.string.widget_extra_funds_share)
                } else if (budgeted > 0) {
                    val pct = if (income > 0) budgeted / income * 100.0 else 0.0
                    context.getString(R.string.widget_of_income, String.format(Locale.US, "%.0f%%", pct))
                } else {
                    context.getString(R.string.widget_not_in_budget)
                }
                views.setTextViewText(R.id.widget_graph_share, share)
            }
            views.setTextViewText(R.id.widget_graph_oob_head_val, BudgetStore.money(outOfBudget))
            views.setTextColor(
                R.id.widget_graph_oob_head_val,
                if (outOfBudget > 0.009) errInk(context, store) else onInk(context, store),
            )
            if (slice?.id == BudgetStore.EXTRA_FUNDS_ID) {
                val added = store.extraFundsAdded()
                val monthFunds = max(0.0, slice.envelope - added)
                views.setTextViewText(R.id.widget_stat_budgeted, BudgetStore.money(monthFunds))
                views.setTextViewText(R.id.widget_stat_budgeted_lbl, context.getString(R.string.widget_stat_month_funds))
                views.setTextViewText(R.id.widget_stat_spent, BudgetStore.money(added))
                views.setTextViewText(R.id.widget_stat_spent_lbl, context.getString(R.string.widget_stat_added_funds))
                views.setTextColor(
                    R.id.widget_stat_spent,
                    if (added > 0.009) primaryInk(context, store) else onInk(context, store),
                )
                views.setTextViewText(R.id.widget_stat_left, BudgetStore.money(slice.spent))
                views.setTextViewText(R.id.widget_stat_left_lbl, context.getString(R.string.widget_stat_funds_lost))
                views.setTextColor(
                    R.id.widget_stat_left,
                    if (slice.spent > 0.009) errInk(context, store) else onInk(context, store),
                )
            } else {
                val over = left < 0
                views.setTextViewText(
                    R.id.widget_stat_budgeted,
                    if (envelope > 0) BudgetStore.money(envelope) else "—",
                )
                views.setTextViewText(R.id.widget_stat_budgeted_lbl, context.getString(R.string.widget_stat_budgeted))
                views.setTextViewText(R.id.widget_stat_spent, BudgetStore.money(spent))
                views.setTextViewText(R.id.widget_stat_spent_lbl, context.getString(R.string.widget_stat_spent))
                views.setTextColor(R.id.widget_stat_spent, onInk(context, store))
                views.setTextViewText(R.id.widget_stat_left, BudgetStore.money(if (over) -left else left))
                views.setTextColor(
                    R.id.widget_stat_left,
                    if (over) errInk(context, store) else onInk(context, store),
                )
                views.setTextViewText(
                    R.id.widget_stat_left_lbl,
                    context.getString(if (over) R.string.widget_stat_over else R.string.widget_stat_left),
                )
            }
        }

        private fun padViews(context: Context, store: BudgetStore, id: Int): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_pad)
            applyChrome(context, store, views)
            val pad = store.widgetPad(id)
            val amount = BudgetStore.parsePad(pad)
            val selected = store.selectedSlice(id)?.let { sid -> store.slices().find { it.id == sid } }
            views.setTextViewText(R.id.widget_amount, BudgetStore.padDisplay(pad))
            views.setTextColor(R.id.widget_amount, onInk(context, store))
            views.setTextColor(R.id.widget_cancel, onInk(context, store))
            val keyBg = if (widgetLight(context, store)) R.drawable.widget_key_bg_light else R.drawable.widget_key_bg
            val keyIds = intArrayOf(
                R.id.key_1, R.id.key_2, R.id.key_3,
                R.id.key_4, R.id.key_5, R.id.key_6,
                R.id.key_7, R.id.key_8, R.id.key_9,
                R.id.key_dot, R.id.key_0, R.id.key_back,
            )
            keyIds.forEach { keyId ->
                views.setInt(keyId, "setBackgroundResource", keyBg)
                views.setTextColor(keyId, onInk(context, store))
            }
            views.setInt(R.id.widget_cancel, "setBackgroundResource", keyBg)
            views.setBoolean(R.id.widget_next, "setEnabled", amount > 0)
            views.setTextViewText(
                R.id.widget_next,
                when {
                    selected?.id == BudgetStore.EXTRA_FUNDS_ID -> context.getString(R.string.widget_add_funds)
                    selected != null -> context.getString(R.string.widget_add_to, selected.name)
                    else -> context.getString(R.string.widget_continue)
                },
            )
            val keys = listOf(
                R.id.key_1 to "1", R.id.key_2 to "2", R.id.key_3 to "3",
                R.id.key_4 to "4", R.id.key_5 to "5", R.id.key_6 to "6",
                R.id.key_7 to "7", R.id.key_8 to "8", R.id.key_9 to "9",
                R.id.key_dot to ".", R.id.key_0 to "0", R.id.key_back to "back",
            )
            keys.forEachIndexed { index, pair ->
                views.setOnClickPendingIntent(pair.first, action(context, id, OP_KEY, 10 + index, pair.second))
            }
            views.setOnClickPendingIntent(R.id.widget_cancel, action(context, id, OP_CANCEL, 2))
            views.setOnClickPendingIntent(R.id.widget_next, action(context, id, OP_NEXT, 3))
            return views
        }

        private fun catViews(context: Context, store: BudgetStore, id: Int): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_cats)
            applyChrome(context, store, views)
            views.setTextViewText(R.id.widget_amount, "Logging ${BudgetStore.money(store.widgetAmount(id))}")
            views.setTextColor(R.id.widget_amount, onInk(context, store))
            views.setTextColor(R.id.widget_label, softInk(context, store))
            views.setTextColor(R.id.widget_cancel, onInk(context, store))
            val svc = Intent(context, CategoryRemoteService::class.java)
            svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            svc.data = Uri.parse("widget://cats/$id/${store.widgetAmount(id)}")
            views.setRemoteAdapter(R.id.widget_cat_list, svc)
            val template = action(context, id, OP_CAT, 4, mutable = true)
            views.setPendingIntentTemplate(R.id.widget_cat_list, template)
            views.setOnClickPendingIntent(R.id.widget_cancel, action(context, id, OP_CANCEL, 2))
            return views
        }

        private fun action(
            context: Context,
            id: Int,
            op: String,
            code: Int,
            key: String? = null,
            mutable: Boolean = false,
        ): PendingIntent {
            val intent = Intent(context, WheelWidgetProvider::class.java)
            intent.action = ACTION
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            intent.putExtra(EXTRA_OP, op)
            if (key != null) intent.putExtra(EXTRA_KEY, key)
            intent.data = Uri.parse("widget://op/$id/$op/$code/$key")
            return PendingIntent.getBroadcast(context, id * 256 + code, intent, flags(mutable))
        }

        private fun openApp(context: Context, id: Int): PendingIntent {
            val intent = Intent(context, MainActivity::class.java)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            return PendingIntent.getActivity(context, id, intent, flags())
        }

        private fun wheelSizePx(context: Context, manager: AppWidgetManager, id: Int): Int {
            val opts = manager.getAppWidgetOptions(id)
            val minW = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 200)
            val minH = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 250)
            val wheelDp = kotlin.math.min(minW - 28, minH - 120).coerceIn(160, 280)
            val px = TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                wheelDp.toFloat(),
                context.resources.displayMetrics,
            ).toInt()
            return (px * 2).coerceIn(480, 960)
        }

        private fun flags(mutable: Boolean = false): Int {
            return if (Build.VERSION.SDK_INT >= 31) {
                PendingIntent.FLAG_UPDATE_CURRENT or
                    if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
        }

    }
}

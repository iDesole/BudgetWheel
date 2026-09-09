package com.budgetwheel.app.widget

import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.budgetwheel.app.BudgetStore
import com.budgetwheel.app.R
import kotlin.math.min

/** Bar list for the widget graph. Rows match the in-app budget chart; selection is shown in the header. */
class GraphRemoteService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return Factory(applicationContext, intent)
    }

    private class Factory(
        private val context: android.content.Context,
        intent: Intent,
    ) : RemoteViewsFactory {
        private val widgetId = intent.getIntExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID, 0)
        private var rows: List<BudgetStore.Slice> = emptyList()
        private var selectedId: String? = null

        override fun onCreate() {}

        override fun onDataSetChanged() {
            val store = BudgetStore(context)
            rows = store.slices()
            selectedId = store.selectedSlice(widgetId)
        }

        override fun onDestroy() {}

        override fun getCount(): Int = rows.size

        override fun getViewAt(position: Int): RemoteViews {
            val row = rows.getOrNull(position) ?: return RemoteViews(context.packageName, R.layout.widget_graph_row)
            val views = RemoteViews(context.packageName, R.layout.widget_graph_row)
            views.setInt(
                R.id.graph_row,
                "setBackgroundResource",
                if (row.id == selectedId) R.drawable.widget_bar_card_on else R.drawable.widget_bar_card,
            )
            val store = BudgetStore(context)
            val on = context.getColor(if (store.isLightTheme(context)) R.color.bw_on_light else R.color.bw_on)
            val soft = context.getColor(if (store.isLightTheme(context)) R.color.bw_soft_light else R.color.bw_soft)
            views.setTextViewText(R.id.bar_name, row.name)
            views.setTextColor(R.id.bar_name, on)
            val extra = row.id == BudgetStore.EXTRA_FUNDS_ID
            val envLabel = if (row.envelope > 0) BudgetStore.money(row.envelope) else "—"
            views.setTextViewText(
                R.id.bar_amt,
                if (extra) "${BudgetStore.money(row.spent)} lost of $envLabel"
                else "${BudgetStore.money(row.spent)} of $envLabel",
            )
            views.setTextColor(R.id.bar_amt, soft)
            views.setTextColor(R.id.bar_pct, soft)
            val over = row.envelope > 0 && row.spent > row.envelope + 0.009
            val pct = if (row.envelope > 0) {
                min(100.0, row.spent / row.envelope * 100.0)
            } else if (row.spent > 0) {
                100.0
            } else {
                0.0
            }
            val left = row.envelope - row.spent
            views.setTextViewText(
                R.id.bar_pct,
                if (row.envelope > 0) BudgetStore.formatPct(pct) else if (extra) "Pool" else "No budget",
            )
            views.setTextViewText(
                R.id.bar_left,
                if (left < 0) "${BudgetStore.money(-left)} over" else "${BudgetStore.money(left)} left",
            )
            views.setTextColor(
                R.id.bar_left,
                if (left < 0) context.getColor(R.color.bw_warn) else soft,
            )
            val fill = if (over) context.getColor(R.color.bw_error) else WidgetBitmaps.color(row.color)
            views.setImageViewBitmap(R.id.bar_track, WidgetBitmaps.bar(context, fill, pct.toFloat()))
            val tap = Intent()
            tap.putExtra(WheelWidgetProvider.EXTRA_OP, WheelWidgetProvider.OP_GRAPH)
            tap.putExtra(WheelWidgetProvider.EXTRA_CAT, row.id)
            tap.putExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
            views.setOnClickFillInIntent(R.id.graph_row, tap)
            return views
        }

        override fun getLoadingView(): RemoteViews? = null

        override fun getViewTypeCount(): Int = 1

        override fun getItemId(position: Int): Long = rows.getOrNull(position)?.id.hashCode().toLong()

        override fun hasStableIds(): Boolean = true
    }
}

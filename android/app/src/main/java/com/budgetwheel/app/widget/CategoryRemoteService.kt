package com.budgetwheel.app.widget

import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.budgetwheel.app.BudgetStore
import com.budgetwheel.app.R

/** Category list for the widget "I purchased" picker. Extra Funds is omitted, same as the app. */
class CategoryRemoteService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return Factory(applicationContext, intent)
    }

    private class Factory(
        private val context: android.content.Context,
        intent: Intent,
    ) : RemoteViewsFactory {
        private val widgetId = intent.getIntExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID, 0)
        private var rows: List<BudgetStore.Slice> = emptyList()
        private var amount = 0.0
        private var monthlyIncome = 0.0

        override fun onCreate() {}

        override fun onDataSetChanged() {
            val store = BudgetStore(context)
            amount = store.widgetAmount(widgetId)
            monthlyIncome = store.monthlyIncome()
            rows = store.visibleCategories().filter { it.id != BudgetStore.EXTRA_FUNDS_ID }
        }

        override fun onDestroy() {}

        override fun getCount(): Int = rows.size

        override fun getViewAt(position: Int): RemoteViews {
            val row = rows.getOrNull(position) ?: return RemoteViews(context.packageName, R.layout.widget_cat_row)
            val views = RemoteViews(context.packageName, R.layout.widget_cat_row)
            val store = BudgetStore(context)
            val light = store.isLightTheme(context)
            views.setInt(
                R.id.cat_row,
                "setBackgroundResource",
                if (light) R.drawable.widget_cat_card_light else R.drawable.widget_cat_card,
            )
            val on = context.getColor(if (light) R.color.bw_on_light else R.color.bw_on)
            views.setTextViewText(R.id.cat_name, row.name)
            views.setTextColor(R.id.cat_name, on)
            val left = row.envelope - row.spent
            val hasBudget = row.budgeted > 0
            views.setTextViewText(
                R.id.cat_left,
                if (hasBudget) "${BudgetStore.money(left)} left" else "No budget set",
            )
            val soft = context.getColor(if (store.isLightTheme(context)) R.color.bw_soft_light else R.color.bw_soft)
            views.setTextColor(
                R.id.cat_left,
                if (hasBudget && left < amount) context.getColor(R.color.bw_warn) else soft,
            )
            if (hasBudget && monthlyIncome > 0) {
                val share = row.budgeted / monthlyIncome * 100.0
                views.setTextViewText(R.id.cat_pct, BudgetStore.formatPct(share))
                views.setTextColor(R.id.cat_pct, context.getColor(if (light) R.color.bw_primary_light else R.color.bw_primary))
            } else {
                views.setTextViewText(R.id.cat_pct, "—")
                views.setTextColor(R.id.cat_pct, context.getColor(if (light) R.color.bw_outline_light else R.color.bw_outline_soft))
            }
            views.setImageViewBitmap(R.id.cat_swatch, WidgetBitmaps.swatch(context, row.color))
            val fill = Intent()
            fill.putExtra(WheelWidgetProvider.EXTRA_OP, WheelWidgetProvider.OP_CAT)
            fill.putExtra(WheelWidgetProvider.EXTRA_CAT, row.id)
            fill.putExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
            views.setOnClickFillInIntent(R.id.cat_row, fill)
            return views
        }

        override fun getLoadingView(): RemoteViews? = null

        override fun getViewTypeCount(): Int = 1

        override fun getItemId(position: Int): Long = rows.getOrNull(position)?.id.hashCode().toLong()

        override fun hasStableIds(): Boolean = true
    }
}

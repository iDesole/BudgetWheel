package com.budgetwheel.app.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.util.TypedValue
import com.budgetwheel.app.BudgetStore
import com.budgetwheel.app.R

/**
 * Tiny bitmaps the home-screen widget paints into RemoteViews.
 * Color parsing matches [com.budgetwheel.app.WheelRenderer].
 */
object WidgetBitmaps {
    fun color(hex: String): Int {
        return try {
            Color.parseColor(if (hex.startsWith("#")) hex else "#$hex")
        } catch (_: Exception) {
            Color.parseColor("#F0C94D")
        }
    }

    fun swatch(context: Context, hex: String): Bitmap {
        val size = dp(context, 28f).coerceAtLeast(28)
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val cx = size / 2f
        val border = size * 0.08f
        val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        fill.color = color(hex)
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG)
        stroke.style = Paint.Style.STROKE
        stroke.strokeWidth = border
        stroke.color = context.getColor(
            if (BudgetStore(context).isLightTheme(context)) R.color.bw_outline_light else R.color.bw_surface4,
        )
        val r = cx - border
        canvas.drawCircle(cx, cx, r, fill)
        canvas.drawCircle(cx, cx, r, stroke)
        return bmp
    }

    fun bar(context: Context, fillColor: Int, pct: Float): Bitmap {
        val w = (dp(context, 280f) * 2).coerceAtLeast(160)
        val h = (dp(context, 10f) * 2).coerceAtLeast(16)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val track = Paint(Paint.ANTI_ALIAS_FLAG)
        track.isDither = true
        track.color = context.getColor(
            if (BudgetStore(context).isLightTheme(context)) R.color.bw_surface2_light else R.color.bw_surface2,
        )
        val rr = h / 2f
        canvas.drawRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), rr, rr, track)
        val fillW = w * (pct / 100f).coerceIn(0f, 1f)
        if (fillW > 0.5f) {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            paint.isDither = true
            paint.color = fillColor
            canvas.drawRoundRect(RectF(0f, 0f, fillW, h.toFloat()), rr, rr, paint)
        }
        return bmp
    }

    private fun dp(context: Context, value: Float): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            context.resources.displayMetrics,
        ).toInt()
    }
}

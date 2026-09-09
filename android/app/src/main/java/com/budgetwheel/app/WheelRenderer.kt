package com.budgetwheel.app

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** Keep ring math in lockstep with src/ui/wheel.ts. One ring; 360° is the sum of slice sizes. */
object WheelRenderer {
    private const val VIEW = 320f
    private const val HOLE = 84f
    private const val RING = 64f
    private const val SEAM = 0.7f
    private const val FULL = 359.9f
    private const val EPS = 0.009
    private val PALETTE = arrayOf(
        "#ED0A3F", "#FD0E35", "#C62D42", "#CA3435", "#B94E48", "#FF3F34", "#FE6F5E",
        "#FF7034", "#FF8833", "#FFB97B", "#FFAE42", "#FCD667", "#FED85D", "#FBE870",
        "#F1E788", "#B5B35C", "#ECEBBD", "#C5E17A", "#7BA05B", "#9DE093", "#01A368",
        "#5FA777", "#93DFB8", "#00CCCC", "#6CDAE7", "#76D7EA", "#0095B7", "#009DC4",
        "#02A4D3", "#93CCEA", "#0066FF", "#A9B2C3", "#C3CDE6", "#263A79", "#6456B7",
        "#8071B4", "#8359A3", "#C9A0DC", "#E29CD2", "#843179", "#BB3385", "#F653A6",
        "#FF3399", "#FBAED2", "#FFA6C9", "#F7468A", "#FC80A5", "#F091A9", "#FF91A4",
        "#FEBAAD", "#E97451", "#AF593E", "#9E5B40", "#D27D46", "#DEA681", "#FA9D5A",
        "#FFCBA4", "#FDD5B1", "#E6BE8A", "#C9C0BB", "#000000", "#8B8680", "#D9D6CF",
        "#FFFFFF",
    )

    data class Center(
        val label: String,
        val value: String,
        val sub: String,
        val negative: Boolean,
    )

    private data class Weighted(val slice: BudgetStore.Slice, val weight: Float)

    private data class Rings(
        val hole: Float,
        val mainOuter: Float,
    )

    fun draw(
        slices: List<BudgetStore.Slice>,
        sizePx: Int,
        center: Center,
        selectedId: String? = null,
        showCenter: Boolean = true,
        light: Boolean = false,
    ): Bitmap {
        val size = max(200, sizePx)
        val scale = size / VIEW
        val pad = max(18, (size * 0.08f).toInt())
        val bmp = Bitmap.createBitmap(size + pad * 2, size + pad * 2, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.translate(pad.toFloat(), pad.toFloat())

        val wheel = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        drawWheel(Canvas(wheel), slices, size, scale, selectedId, light)

        if (light) {
            canvas.drawBitmap(wheel, 0f, 0f, null)
        } else {
            val shadow = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
            shadow.isFilterBitmap = true
            shadow.isDither = true
            shadow.setShadowLayer(24f * scale, 0f, 10f * scale, 0x47000000.toInt())
            canvas.drawBitmap(wheel, 0f, 0f, shadow)
        }
        wheel.recycle()

        if (showCenter) drawCenter(canvas, size, scale, center, light)
        return bmp
    }

    private fun drawWheel(
        canvas: Canvas,
        slices: List<BudgetStore.Slice>,
        size: Int,
        scale: Float,
        selectedId: String?,
        light: Boolean,
    ) {
        val cx = size / 2f
        val cy = size / 2f
        val painted = paintOutOfBudget(slices)
        val weighted = sliceWeights(painted)
        val rings = layoutRing(scale)

        if (weighted.isEmpty()) {
            val ring = Paint(Paint.ANTI_ALIAS_FLAG)
            ring.style = Paint.Style.STROKE
            ring.strokeWidth = rings.mainOuter - rings.hole
            ring.color = Color.parseColor(if (light) "#D4CDB8" else "#49454F")
            canvas.drawCircle(cx, cy, (rings.hole + rings.mainOuter) / 2f, ring)
            return
        }

        drawRing(canvas, weighted, rings.hole, rings.mainOuter, cx, cy, selectedId, scale)
    }

    private fun layoutRing(scale: Float): Rings {
        val hole = HOLE * scale
        return Rings(hole, hole + RING * scale)
    }

    private fun isOutOfBudget(slice: BudgetStore.Slice): Boolean {
        return slice.id != BudgetStore.EXTRA_FUNDS_ID && slice.envelope <= EPS && slice.spent > EPS
    }

    private fun paintOutOfBudget(slices: List<BudgetStore.Slice>): List<BudgetStore.Slice> {
        val used = slices.filter { !isOutOfBudget(it) }.map { it.color.uppercase() }.toMutableSet()
        return slices.map { slice ->
            if (!isOutOfBudget(slice)) {
                slice
            } else if (used.add(slice.color.uppercase())) {
                slice
            } else {
                val next = unusedColor(used)
                used.add(next.uppercase())
                slice.copy(color = next)
            }
        }
    }

    fun unusedDisplayColor(used: Set<String>): String {
        val taken = used.map { it.uppercase() }.toSet()
        return PALETTE.firstOrNull { it.uppercase() !in taken } ?: "#8B8680"
    }

    private fun unusedColor(used: Set<String>): String = unusedDisplayColor(used)

    private fun sliceWeights(slices: List<BudgetStore.Slice>): List<Weighted> {
        return slices.mapNotNull { s ->
            val weight = if (s.id == BudgetStore.EXTRA_FUNDS_ID) {
                max(0.0, s.envelope - s.spent)
            } else {
                max(0.0, max(s.envelope, s.spent))
            }
            if (weight > EPS) Weighted(s, weight.toFloat()) else null
        }
    }

    private fun drawRing(
        canvas: Canvas,
        items: List<Weighted>,
        r0: Float,
        r1: Float,
        cx: Float,
        cy: Float,
        selectedId: String?,
        scale: Float,
    ) {
        val total = items.sumOf { it.weight.toDouble() }.toFloat()
        if (total <= 0f) return
        var angle = 0f
        val seam = if (items.size > 1) SEAM else 0f
        val later = ArrayList<PathPaint>()
        val first = ArrayList<PathPaint>()
        for (item in items) {
            if (angle >= FULL) break
            val sweep = min(FULL - angle, item.weight / total * 360f)
            val gap = if (sweep > seam) seam else 0f
            val a0 = angle
            val a1 = angle + sweep - gap
            angle += sweep
            if (a1 <= a0) continue
            val selected = selectedId != null && selectedId == item.slice.id
            val grow = if (selected) 7f * scale else 0f
            val sr0 = max(8f * scale, r0 - grow * 0.35f)
            val sr1 = r1 + grow
            val part = PathPaint(donutPath(cx, cy, sr0, sr1, a0, a1), parseColor(item.slice.color))
            if (selected) later.add(part) else first.add(part)
        }
        for (part in first + later) {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            paint.style = Paint.Style.FILL
            paint.color = part.color
            paint.isDither = true
            paint.isFilterBitmap = true
            canvas.drawPath(part.path, paint)
            val edge = Paint(paint)
            edge.style = Paint.Style.STROKE
            edge.strokeWidth = 0.8f * scale
            edge.strokeJoin = Paint.Join.ROUND
            canvas.drawPath(part.path, edge)
        }
    }

    private data class PathPaint(val path: Path, val color: Int)

    private fun donutPath(cx: Float, cy: Float, r0: Float, r1: Float, a0: Float, a1: Float): Path {
        val span = a1 - a0
        val path = Path()
        if (span >= FULL) {
            path.addCircle(cx, cy, r1, Path.Direction.CW)
            path.addCircle(cx, cy, r0, Path.Direction.CCW)
            path.fillType = Path.FillType.EVEN_ODD
            return path
        }
        val start = a0 - 90f
        val sweep = span
        val outer = RectF(cx - r1, cy - r1, cx + r1, cy + r1)
        val inner = RectF(cx - r0, cy - r0, cx + r0, cy + r0)
        val rad0 = Math.toRadians(start.toDouble())
        val rad1 = Math.toRadians((start + sweep).toDouble())
        path.moveTo(cx + r1 * cos(rad0).toFloat(), cy + r1 * sin(rad0).toFloat())
        path.arcTo(outer, start, sweep, false)
        path.lineTo(cx + r0 * cos(rad1).toFloat(), cy + r0 * sin(rad1).toFloat())
        path.arcTo(inner, start + sweep, -sweep, false)
        path.close()
        return path
    }

    private fun drawCenter(canvas: Canvas, size: Int, scale: Float, center: Center, light: Boolean) {
        val cx = size / 2f
        val cy = size / 2f
        val hole = HOLE * scale
        val maxW = hole * 1.62f
        val maxH = hole * 1.62f
        val on = if (light) "#1C1B16" else "#F4EFF7"
        val soft = if (light) "#5C5748" else "#CAC4D0"
        if (light) {
            val fill = Paint(Paint.ANTI_ALIAS_FLAG)
            fill.color = Color.parseColor("#F3EFE6")
            canvas.drawCircle(cx, cy, hole * 0.98f, fill)
        }

        val label = paint(Color.parseColor(soft), Typeface.create("sans-serif-medium", Typeface.NORMAL))
        val value = paint(
            Color.parseColor(if (center.negative) (if (light) "#BA1A1A" else "#FFB4AB") else on),
            Typeface.create("sans-serif-medium", Typeface.BOLD),
        )
        val sub = paint(Color.parseColor(soft), Typeface.create("sans-serif", Typeface.NORMAL))

        val labelSrc = center.label.uppercase()
        val valueSrc = center.value
        val subLines = splitSub(center.sub)

        var fit = 1f
        var gap = 3f * scale
        while (fit > 0.42f) {
            label.textSize = 12f * scale * fit
            label.letterSpacing = 0.04f * fit
            value.textSize = 25f * scale * fit
            sub.textSize = 11f * scale * fit
            gap = 3f * scale * fit
            val h = lineH(label) + gap + lineH(value) + gap + subLines.size * lineH(sub)
            val w = maxOf(
                label.measureText(labelSrc),
                value.measureText(valueSrc),
                subLines.maxOf { sub.measureText(it) },
            )
            if (w <= maxW && h <= maxH) break
            fit *= 0.88f
        }

        val lines = ArrayList<Pair<String, Paint>>()
        lines.add(labelSrc to label)
        lines.add(valueSrc to value)
        for (line in subLines) lines.add(line to sub)

        val totalH = lines.sumOf { lineH(it.second).toDouble() }.toFloat() + gap * (lines.size - 1)
        var y = cy - totalH / 2f
        for (i in lines.indices) {
            val text = lines[i].first
            val paint = lines[i].second
            y += -paint.fontMetrics.ascent
            canvas.drawText(text, cx, y, paint)
            y += paint.fontMetrics.descent
            if (i < lines.lastIndex) y += gap
        }
    }

    private fun splitSub(sub: String): List<String> {
        listOf(" spent of " to " spent", " lost of " to " lost").forEach { (marker, verb) ->
            val at = sub.indexOf(marker)
            if (at > 0) return listOf(sub.substring(0, at) + verb, "of " + sub.substring(at + marker.length))
        }
        return listOf(sub)
    }

    private fun paint(color: Int, typeface: Typeface): Paint {
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = color
        p.textAlign = Paint.Align.CENTER
        p.typeface = typeface
        p.isSubpixelText = true
        return p
    }

    private fun lineH(paint: Paint): Float {
        val fm = paint.fontMetrics
        return fm.descent - fm.ascent
    }

    private fun parseColor(hex: String): Int {
        return try {
            Color.parseColor(if (hex.startsWith("#")) hex else "#$hex")
        } catch (_: Exception) {
            Color.parseColor("#F0C94D")
        }
    }
}

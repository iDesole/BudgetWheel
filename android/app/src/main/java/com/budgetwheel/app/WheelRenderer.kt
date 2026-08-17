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

/** Keep ring math in lockstep with src/ui/wheel.ts. Large overspend wraps one income per exterior ring. */
object WheelRenderer {
    private const val VIEW = 320f
    private const val MAX_R = 144f
    private const val HOLE = 84f
    private const val PREFERRED_MAIN = 64f
    private const val PREFERRED_OVER = 32f
    private const val RING_GAP = 2f
    private const val MAX_LAYERS = 8
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
        val overThick: Float,
        val gap: Float,
    )

    fun draw(
        slices: List<BudgetStore.Slice>,
        income: Double,
        sizePx: Int,
        center: Center,
        selectedId: String? = null,
    ): Bitmap {
        val size = max(200, sizePx)
        val scale = size / VIEW
        val pad = max(18, (size * 0.08f).toInt())
        val bmp = Bitmap.createBitmap(size + pad * 2, size + pad * 2, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.translate(pad.toFloat(), pad.toFloat())

        val wheel = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        drawWheel(Canvas(wheel), slices, income.toFloat().coerceAtLeast(0f), size, scale, selectedId)

        val shadow = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        shadow.isFilterBitmap = true
        shadow.isDither = true
        shadow.setShadowLayer(24f * scale, 0f, 10f * scale, 0x47000000.toInt())
        canvas.drawBitmap(wheel, 0f, 0f, shadow)
        wheel.recycle()

        drawCenter(canvas, size, scale, center)
        return bmp
    }

    private fun drawWheel(
        canvas: Canvas,
        slices: List<BudgetStore.Slice>,
        income: Float,
        size: Int,
        scale: Float,
        selectedId: String?,
    ) {
        val cx = size / 2f
        val cy = size / 2f
        val envelopeTotal = slices.sumOf { max(0.0, it.envelope) }.toFloat()
        val spentTotal = slices.sumOf { max(0.0, it.spent) }.toFloat()

        if (slices.isEmpty() || (income <= 0f && envelopeTotal <= 0f && spentTotal <= 0f)) {
            val rings = layoutRings(0, scale)
            val ring = Paint(Paint.ANTI_ALIAS_FLAG)
            ring.style = Paint.Style.STROKE
            ring.strokeWidth = rings.mainOuter - rings.hole
            ring.color = Color.parseColor("#49454F")
            canvas.drawCircle(cx, cy, (rings.hole + rings.mainOuter) / 2f, ring)
            return
        }

        val painted = paintOutOfBudget(slices)
        val cores = coreWeights(painted)
        val overflow = painted.mapNotNull { s ->
            val extra = overflowWeight(s)
            if (extra > 0.009) Weighted(s, extra.toFloat()) else null
        }
        val budgetTotal = cores.sumOf { it.weight.toDouble() }.toFloat()
        val overflowTotal = overflow.sumOf { it.weight.toDouble() }.toFloat()
        val unit = if (income > 0.009f) income else max(budgetTotal, overflowTotal)
        val coreLayers = layersByCost(cores, unit)
        val assignedOver = coreLayers.drop(1)
        val placed = placeSpendOverflow(
            coreLayers.firstOrNull().orEmpty(),
            min(budgetTotal, unit),
            overflow,
            unit,
        )
        val overLayers = (assignedOver + placed.second).take(MAX_LAYERS)
        val rings = layoutRings(overLayers.size, scale)

        if (placed.first.isNotEmpty()) {
            drawRing(canvas, placed.first, rings.hole, rings.mainOuter, unit, cx, cy, selectedId, scale)
        }
        overLayers.forEachIndexed { index, layer ->
            val r0 = rings.mainOuter + rings.gap + index * (rings.overThick + rings.gap)
            drawRing(canvas, layer, r0, r0 + rings.overThick, unit, cx, cy, selectedId, scale)
        }
    }

    private fun layoutRings(overCount: Int, scale: Float): Rings {
        val hole = HOLE * scale
        val gap = RING_GAP * scale
        val needed = hole + PREFERRED_MAIN * scale + overCount * (PREFERRED_OVER * scale + gap)
        if (overCount <= 0 || needed <= MAX_R * scale) {
            return Rings(hole, hole + PREFERRED_MAIN * scale, PREFERRED_OVER * scale, gap)
        }
        val remain = MAX_R * scale - hole
        val mainThick = max(28f * scale, (remain - overCount * gap) / (1f + overCount / 2f))
        return Rings(hole, hole + mainThick, mainThick / 2f, gap)
    }

    private fun isOutOfBudget(slice: BudgetStore.Slice): Boolean {
        return slice.id != BudgetStore.EXTRA_FUNDS_ID && slice.envelope <= 0.009 && slice.spent > 0.009
    }

    private fun overflowWeight(slice: BudgetStore.Slice): Double {
        return if (slice.envelope <= 0.009) max(0.0, slice.spent) else max(0.0, slice.spent - slice.envelope)
    }

    private fun placeSpendOverflow(
        inner: List<Weighted>,
        assignedOnInner: Float,
        overflow: List<Weighted>,
        unit: Float,
    ): Pair<List<Weighted>, List<List<Weighted>>> {
        if (overflow.isEmpty()) return inner to emptyList()
        val room = max(0f, unit - assignedOnInner)
        val leftover = ArrayList<Weighted>()
        val nextInner = ArrayList(inner)
        if (room > 0.009f) {
            var left = room
            for (item in overflow) {
                if (left <= 0.009f) {
                    leftover.add(item)
                    continue
                }
                val take = min(item.weight, left)
                nextInner.add(Weighted(item.slice, take))
                left -= take
                if (item.weight - take > 0.009f) leftover.add(Weighted(item.slice, item.weight - take))
            }
        } else {
            leftover.addAll(overflow)
        }
        val over = if (leftover.isEmpty()) {
            emptyList()
        } else {
            splitLayers(leftover.sortedByDescending { it.weight }, unit).take(MAX_LAYERS)
        }
        return nextInner to over
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

    private fun coreWeights(slices: List<BudgetStore.Slice>): List<Weighted> {
        val unbudgeted = slices
            .filter { isOutOfBudget(it) }
            .sumOf { max(0.0, it.spent) }
        return slices.mapNotNull { s ->
            val weight = when {
                s.id == BudgetStore.EXTRA_FUNDS_ID -> max(0.0, s.envelope - unbudgeted)
                s.envelope > 0.009 -> s.envelope
                else -> 0.0
            }
            if (weight > 0.009) Weighted(s, weight.toFloat()) else null
        }
    }

    private fun splitLayers(sized: List<Weighted>, unit: Float): List<List<Weighted>> {
        if (unit <= 0.009f) return if (sized.isEmpty()) emptyList() else listOf(sized)
        val layers = ArrayList<ArrayList<Weighted>>()
        layers.add(ArrayList())
        var room = unit
        for (slice in sized) {
            var left = slice.weight
            while (left > 0.009f) {
                if (room <= 0.009f) {
                    layers.add(ArrayList())
                    room = unit
                }
                val take = min(left, room)
                layers.last().add(Weighted(slice.slice, take))
                left -= take
                room -= take
            }
        }
        return layers.filter { it.isNotEmpty() }
    }

    private fun layersByCost(items: List<Weighted>, unit: Float): List<List<Weighted>> {
        if (items.isEmpty()) return emptyList()
        if (unit <= 0.009f) return listOf(items)
        val total = items.sumOf { it.weight.toDouble() }.toFloat()
        if (total <= unit + 0.009f) return listOf(items)
        return splitLayers(items.sortedBy { it.weight }, unit)
    }

    private fun drawRing(
        canvas: Canvas,
        items: List<Weighted>,
        r0: Float,
        r1: Float,
        fullCircleAt: Float,
        cx: Float,
        cy: Float,
        selectedId: String?,
        scale: Float,
    ) {
        val total = items.sumOf { it.weight.toDouble() }.toFloat()
        if (total <= 0f) return
        val circleAt = if (fullCircleAt > 0f) fullCircleAt else total
        var angle = 0f
        val seam = if (items.size > 1) 0.7f else 0f
        val later = ArrayList<PathPaint>()
        val first = ArrayList<PathPaint>()
        for (item in items) {
            val sweep = min(359.9f, item.weight / circleAt * 360f)
            val a0 = angle
            val a1 = angle + sweep - seam
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
        if (span >= 359.9f) {
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

    private fun drawCenter(canvas: Canvas, size: Int, scale: Float, center: Center) {
        val cx = size / 2f
        val cy = size / 2f
        val hole = HOLE * scale
        val maxW = hole * 1.62f
        val maxH = hole * 1.62f

        val label = paint(Color.parseColor("#CAC4D0"), Typeface.create("sans-serif-medium", Typeface.NORMAL))
        val value = paint(
            Color.parseColor(if (center.negative) "#FFB4AB" else "#F4EFF7"),
            Typeface.create("sans-serif-medium", Typeface.BOLD),
        )
        val sub = paint(Color.parseColor("#CAC4D0"), Typeface.create("sans-serif", Typeface.NORMAL))

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
        val marker = " spent of "
        val at = sub.indexOf(marker)
        if (at <= 0) return listOf(sub)
        return listOf(sub.substring(0, at) + " spent", "of " + sub.substring(at + marker.length))
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

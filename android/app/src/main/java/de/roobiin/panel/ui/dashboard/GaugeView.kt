package de.roobiin.panel.ui.dashboard

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View

class GaugeView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    private var label: String = ""
    private var value: Double? = null

    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 18f
        color = Color.parseColor("#2a2d3e")
        strokeCap = Paint.Cap.ROUND
    }

    private val fgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 18f
        strokeCap = Paint.Cap.ROUND
    }

    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textAlign = Paint.Align.CENTER
        textSize = 36f
        typeface = Typeface.DEFAULT_BOLD
    }

    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#8b949e")
        textAlign = Paint.Align.CENTER
        textSize = 24f
    }

    fun setMetric(label: String, value: Double?) {
        this.label = label
        this.value = value
        fgPaint.color = when {
            value == null -> Color.GRAY
            value >= 85.0 -> Color.parseColor("#f85149")
            value >= 65.0 -> Color.parseColor("#e3b341")
            else -> Color.parseColor("#3fb950")
        }
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        val radius = (minOf(width, height) / 2f) - 24f
        val oval = RectF(cx - radius, cy - radius, cx + radius, cy + radius)

        canvas.drawArc(oval, 135f, 270f, false, bgPaint)

        val v = value ?: 0.0
        val sweep = (v / 100.0 * 270f).toFloat()
        canvas.drawArc(oval, 135f, sweep, false, fgPaint)

        val valueText = if (value != null) "${String.format("%.0f", v)}%" else "--"
        textPaint.textSize = radius * 0.45f
        canvas.drawText(valueText, cx, cy + textPaint.textSize / 3, textPaint)

        labelPaint.textSize = radius * 0.28f
        canvas.drawText(label, cx, cy + radius * 0.65f, labelPaint)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = MeasureSpec.getSize(widthMeasureSpec).coerceAtMost(300)
        setMeasuredDimension(size, size)
    }
}

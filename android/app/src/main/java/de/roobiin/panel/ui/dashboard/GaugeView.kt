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
        strokeWidth = 24f
        color = Color.parseColor("#1c2128")
        strokeCap = Paint.Cap.ROUND
    }

    private val fgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 24f
        strokeCap = Paint.Cap.ROUND
    }

    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textAlign = Paint.Align.CENTER
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    }

    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#8b949e")
        textAlign = Paint.Align.CENTER
        letterSpacing = 0.1f
    }

    fun setMetric(label: String, value: Double?) {
        this.label = label.uppercase()
        this.value = value
        
        val baseColor = when {
            value == null -> Color.parseColor("#484f58")
            value >= 85.0 -> Color.parseColor("#f85149")
            value >= 70.0 -> Color.parseColor("#e3b341")
            else -> Color.parseColor("#3fb950")
        }
        fgPaint.color = baseColor
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        val radius = (minOf(width, height) / 2f) - 32f
        val oval = RectF(cx - radius, cy - radius, cx + radius, cy + radius)

        // Background Track
        canvas.drawArc(oval, 135f, 270f, false, bgPaint)

        if (value != null) {
            val v = value!!.coerceIn(0.0, 100.0)
            val sweep = (v / 100.0 * 270f).toFloat()
            
            // Subtle glow for the progress arc
            fgPaint.setShadowLayer(12f, 0f, 0f, fgPaint.color)
            canvas.drawArc(oval, 135f, maxOf(1f, sweep), false, fgPaint)
            fgPaint.clearShadowLayer()
        }

        val valueText = if (value != null) "${String.format("%.0f", value)}%" else "--"
        textPaint.textSize = radius * 0.52f
        canvas.drawText(valueText, cx, cy + textPaint.textSize / 3f, textPaint)

        labelPaint.textSize = radius * 0.26f
        canvas.drawText(label, cx, cy + radius * 0.78f, labelPaint)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = MeasureSpec.getSize(widthMeasureSpec).coerceAtMost(400)
        setMeasuredDimension(size, size)
    }
}

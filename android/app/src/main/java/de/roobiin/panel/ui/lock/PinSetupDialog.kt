package de.roobiin.panel.ui.lock

import android.app.Dialog
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.DialogFragment
import de.roobiin.panel.R
import de.roobiin.panel.utils.PinHasher
import kotlinx.coroutines.*

// DialogFragment ohne Lambda-Konstruktor — sicher nach Config-Change/Screen-Rotation
class PinSetupDialog : DialogFragment() {

    interface Listener {
        fun onPinSet(hash: String)
        fun onPinCancelled()
    }

    private val pinBuffer = StringBuilder()
    private var confirmMode = false
    private var firstPin = ""
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private lateinit var tvTitle: TextView
    private lateinit var tvDots: TextView
    private lateinit var tvError: TextView

    private val listener: Listener?
        get() = parentFragment as? Listener ?: activity as? Listener

    companion object {
        const val TAG = "pin_setup"
        fun newInstance() = PinSetupDialog()
    }

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        val view = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_pin_setup, null)

        tvTitle = view.findViewById(R.id.tvPinSetupTitle)
        tvDots  = view.findViewById(R.id.tvPinSetupDots)
        tvError = view.findViewById(R.id.tvPinSetupError)

        val numButtons = listOf(
            view.findViewById<View>(R.id.sBtn0), view.findViewById(R.id.sBtn1),
            view.findViewById(R.id.sBtn2), view.findViewById(R.id.sBtn3),
            view.findViewById(R.id.sBtn4), view.findViewById(R.id.sBtn5),
            view.findViewById(R.id.sBtn6), view.findViewById(R.id.sBtn7),
            view.findViewById(R.id.sBtn8), view.findViewById(R.id.sBtn9)
        )
        numButtons.forEachIndexed { i, btn ->
            btn.setOnClickListener { appendPin(i.toString()) }
        }
        view.findViewById<View>(R.id.sBtnDel).setOnClickListener { deletePin() }

        return AlertDialog.Builder(requireContext())
            .setView(view)
            .setNegativeButton("Abbrechen") { _, _ -> listener?.onPinCancelled() }
            .create()
            .also { it.setCanceledOnTouchOutside(false) }
    }

    private fun appendPin(digit: String) {
        if (pinBuffer.length >= 8) return
        pinBuffer.append(digit)
        updateDots()
        tvError.text = ""
        if (pinBuffer.length >= 4) checkStep()
    }

    private fun deletePin() {
        if (pinBuffer.isNotEmpty()) {
            pinBuffer.deleteCharAt(pinBuffer.length - 1)
            updateDots()
            tvError.text = ""
        }
    }

    private fun updateDots() {
        tvDots.text = "●".repeat(pinBuffer.length) + "○".repeat(maxOf(0, 4 - pinBuffer.length))
    }

    private fun checkStep() {
        if (!confirmMode) {
            firstPin = pinBuffer.toString()
            confirmMode = true
            pinBuffer.clear()
            tvTitle.text = "PIN bestätigen"
            updateDots()
        } else {
            val entered = pinBuffer.toString()
            pinBuffer.clear()
            updateDots()

            if (entered == firstPin) {
                // PBKDF2-Hashing auf IO-Thread
                scope.launch {
                    val hash = withContext(Dispatchers.IO) { PinHasher.hash(entered) }
                    firstPin = "" // Klartext sofort löschen
                    listener?.onPinSet(hash)
                    dismiss()
                }
            } else {
                firstPin = ""
                tvError.text = "PINs stimmen nicht überein"
                confirmMode = false
                tvTitle.text = "Neuen PIN festlegen"
            }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        firstPin = "" // Klartext-PIN aus Speicher löschen
        super.onDestroy()
    }
}

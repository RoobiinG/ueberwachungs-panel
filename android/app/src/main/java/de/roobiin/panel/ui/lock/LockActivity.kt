package de.roobiin.panel.ui.lock

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import de.roobiin.panel.databinding.ActivityLockBinding
import de.roobiin.panel.utils.AppLockManager
import de.roobiin.panel.utils.SessionManager
import java.security.MessageDigest

class LockActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLockBinding
    private lateinit var session: SessionManager
    private val pinBuffer = StringBuilder()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Verhindert Screenshots der Sperrseite
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        binding = ActivityLockBinding.inflate(layoutInflater)
        setContentView(binding.root)

        session = SessionManager(this)
        binding.tvUsername.text = session.getUsername() ?: ""

        setupPinPad()
        setupBiometricButton()

        if (isBiometricAvailable()) {
            showBiometricPrompt()
        }
    }

    // ─── Biometrics ──────────────────────────────────────────────────────────────

    private fun isBiometricAvailable(): Boolean {
        val biometricManager = BiometricManager.from(this)
        return biometricManager.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.BIOMETRIC_WEAK
        ) == BiometricManager.BIOMETRIC_SUCCESS
    }

    private fun showBiometricPrompt() {
        val executor = ContextCompat.getMainExecutor(this)
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                unlockAndProceed()
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                // Biometrie fehlgeschlagen/abgebrochen → PIN-Pad bleibt sichtbar
                binding.tvPinError.text = ""
            }
            override fun onAuthenticationFailed() {
                binding.tvPinError.text = "Biometrie nicht erkannt"
            }
        }

        val prompt = BiometricPrompt(this, executor, callback)
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Überwachungs-Panel")
            .setSubtitle("App entsperren")
            .setNegativeButtonText("PIN eingeben")
            .setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG or
                BiometricManager.Authenticators.BIOMETRIC_WEAK
            )
            .build()

        prompt.authenticate(info)
    }

    private fun setupBiometricButton() {
        if (isBiometricAvailable()) {
            binding.btnBiometric.visibility = android.view.View.VISIBLE
            binding.btnBiometric.setOnClickListener { showBiometricPrompt() }
        } else {
            binding.btnBiometric.visibility = android.view.View.GONE
        }
    }

    // ─── PIN-Pad ─────────────────────────────────────────────────────────────────

    private fun setupPinPad() {
        val numButtons = listOf(
            binding.btn0, binding.btn1, binding.btn2, binding.btn3,
            binding.btn4, binding.btn5, binding.btn6, binding.btn7,
            binding.btn8, binding.btn9
        )
        numButtons.forEachIndexed { index, btn ->
            btn.setOnClickListener { appendPin(index.toString()) }
        }
        binding.btnDel.setOnClickListener { deletePin() }
    }

    private fun appendPin(digit: String) {
        if (pinBuffer.length >= 8) return
        pinBuffer.append(digit)
        updatePinDots()
        binding.tvPinError.text = ""

        if (pinBuffer.length >= 4) {
            checkPin()
        }
    }

    private fun deletePin() {
        if (pinBuffer.isNotEmpty()) {
            pinBuffer.deleteCharAt(pinBuffer.length - 1)
            updatePinDots()
            binding.tvPinError.text = ""
        }
    }

    private fun updatePinDots() {
        binding.tvPinDots.text = "●".repeat(pinBuffer.length) + "○".repeat(maxOf(0, 4 - pinBuffer.length))
    }

    private fun checkPin() {
        val storedHash = session.getPinHash() ?: return
        val enteredHash = sha256(pinBuffer.toString())
        if (enteredHash == storedHash) {
            unlockAndProceed()
        } else if (pinBuffer.length >= 4) {
            binding.tvPinError.text = "Falscher PIN"
            pinBuffer.clear()
            updatePinDots()
        }
    }

    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }

    // ─── Entsperren ──────────────────────────────────────────────────────────────

    private fun unlockAndProceed() {
        AppLockManager.unlock()
        val dest = intent.getStringExtra("navigate_to")
        val resultIntent = Intent().apply {
            if (dest != null) putExtra("navigate_to", dest)
        }
        setResult(RESULT_OK, resultIntent)
        finish()
    }

    // Zurück-Taste sperrt die App, führt nicht raus
    override fun onBackPressed() {
        // absichtlich leer — Lock nicht umgehbar
    }
}

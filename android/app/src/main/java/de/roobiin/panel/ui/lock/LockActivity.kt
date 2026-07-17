package de.roobiin.panel.ui.lock

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import de.roobiin.panel.databinding.ActivityLockBinding
import de.roobiin.panel.utils.AppLockManager
import de.roobiin.panel.utils.PinHasher
import de.roobiin.panel.utils.SessionManager
import kotlinx.coroutines.*

class LockActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLockBinding
    private lateinit var session: SessionManager
    private val pinBuffer = StringBuilder()
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    companion object {
        private const val MAX_ATTEMPTS = 5
        private const val LOCKOUT_DURATION_MS = 30_000L
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        binding = ActivityLockBinding.inflate(layoutInflater)
        setContentView(binding.root)

        session = SessionManager(this)
        binding.tvUsername.text = session.getUsername() ?: ""

        setupPinPad()
        setupBiometricButton()
        checkLockout()

        if (isBiometricAvailable()) {
            showBiometricPrompt()
        }
    }

    // ─── Lockout ─────────────────────────────────────────────────────────────────

    private fun checkLockout() {
        val lockoutUntil = session.getLockoutUntil()
        if (System.currentTimeMillis() < lockoutUntil) {
            startLockoutCountdown(lockoutUntil)
        }
    }

    private fun startLockoutCountdown(until: Long) {
        setPinPadEnabled(false)
        scope.launch {
            while (System.currentTimeMillis() < until) {
                val remaining = ((until - System.currentTimeMillis()) / 1000).coerceAtLeast(0)
                binding.tvPinError.text = "Gesperrt — noch ${remaining}s"
                delay(1000)
            }
            binding.tvPinError.text = ""
            setPinPadEnabled(true)
        }
    }

    private fun setPinPadEnabled(enabled: Boolean) {
        listOf(
            binding.btn0, binding.btn1, binding.btn2, binding.btn3,
            binding.btn4, binding.btn5, binding.btn6, binding.btn7,
            binding.btn8, binding.btn9, binding.btnDel
        ).forEach { it.isEnabled = enabled }
    }

    // ─── Biometrics ──────────────────────────────────────────────────────────────

    private fun isBiometricAvailable(): Boolean {
        val bm = BiometricManager.from(this)
        return bm.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.BIOMETRIC_WEAK
        ) == BiometricManager.BIOMETRIC_SUCCESS
    }

    private fun showBiometricPrompt() {
        val executor = ContextCompat.getMainExecutor(this)
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                session.resetFailedPinAttempts()
                unlockAndProceed()
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
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
            binding.btnBiometric.visibility = View.VISIBLE
            binding.btnBiometric.setOnClickListener { showBiometricPrompt() }
        } else {
            binding.btnBiometric.visibility = View.GONE
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
        if (pinBuffer.length >= 4) checkPin()
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
        val entered = pinBuffer.toString()
        pinBuffer.clear()
        updatePinDots()

        // PBKDF2 ist langsam — auf IO-Thread berechnen
        scope.launch {
            val correct = withContext(Dispatchers.IO) {
                PinHasher.verify(entered, storedHash)
            }
            if (correct) {
                session.resetFailedPinAttempts()
                unlockAndProceed()
            } else {
                val attempts = session.getFailedPinAttempts() + 1
                session.incrementFailedPinAttempts()
                val remaining = MAX_ATTEMPTS - attempts
                if (attempts >= MAX_ATTEMPTS) {
                    val lockoutUntil = System.currentTimeMillis() + LOCKOUT_DURATION_MS
                    session.setLockoutUntil(lockoutUntil)
                    session.resetFailedPinAttempts()
                    startLockoutCountdown(lockoutUntil)
                } else {
                    binding.tvPinError.text = "Falscher PIN — noch $remaining Versuch${if (remaining == 1) "" else "e"}"
                }
            }
        }
    }

    private fun unlockAndProceed() {
        AppLockManager.unlock()
        val dest = intent.getStringExtra("navigate_to")
        setResult(RESULT_OK, Intent().apply {
            if (dest != null) putExtra("navigate_to", dest)
        })
        finish()
    }

    @Suppress("MissingSuperCall", "GestureBackNavigation")
    override fun onBackPressed() {
        // Absichtlich leer — Lock nicht umgehbar
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}

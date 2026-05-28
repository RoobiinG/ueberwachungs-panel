package de.roobiin.panel.ui.login

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import de.roobiin.panel.databinding.ActivityLoginBinding
import de.roobiin.panel.ui.MainActivity
import de.roobiin.panel.ui.lock.LockActivity
import de.roobiin.panel.utils.AppLockManager
import de.roobiin.panel.utils.SessionManager
import de.roobiin.panel.viewmodel.LoginViewModel

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private val vm: LoginViewModel by viewModels()

    private val lockLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            startMain()
        }
        // Bei RESULT_CANCELED bleibt man auf dem Login-Screen
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val session = SessionManager(this)
        if (session.isLoggedIn()) {
            if (session.isAppLockEnabled() && !AppLockManager.isUnlocked) {
                // App-Sperre aktiv und noch nicht entsperrt → LockActivity
                lockLauncher.launch(Intent(this, LockActivity::class.java))
            } else {
                startMain()
            }
            return
        }

        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupObservers()
        setupListeners()
    }

    private fun setupObservers() {
        vm.loading.observe(this) { loading ->
            binding.btnLogin.isEnabled = !loading
            binding.progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        }
        vm.error.observe(this) { err ->
            binding.tvError.text = err ?: ""
            binding.tvError.visibility = if (err != null) View.VISIBLE else View.GONE
        }
        vm.loginSuccess.observe(this) { success ->
            if (success) startMain()
        }
    }

    private fun setupListeners() {
        binding.btnLogin.setOnClickListener {
            vm.login(
                binding.etServerUrl.text.toString().trim(),
                binding.etUsername.text.toString().trim(),
                binding.etPassword.text.toString()
            )
        }
    }

    private fun startMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}

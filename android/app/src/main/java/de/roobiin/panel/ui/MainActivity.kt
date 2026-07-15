package de.roobiin.panel.ui

import android.Manifest
import android.app.Activity.RESULT_OK
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.navigation.fragment.NavHostFragment
import androidx.navigation.ui.setupWithNavController
import de.roobiin.panel.R
import de.roobiin.panel.databinding.ActivityMainBinding
import de.roobiin.panel.service.MonitoringService
import de.roobiin.panel.ui.lock.LockActivity
import de.roobiin.panel.ui.login.LoginActivity
import de.roobiin.panel.utils.AppLockManager
import de.roobiin.panel.utils.AuthState
import de.roobiin.panel.utils.SessionManager

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var session: SessionManager

    private val lockLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode != RESULT_OK) {
            // Sperre nicht überwunden → zurück zum Login
            goToLogin()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        session = SessionManager(this)

        val navHost = supportFragmentManager.findFragmentById(R.id.nav_host_fragment) as NavHostFragment
        val navController = navHost.navController
        binding.bottomNavigation.setupWithNavController(navController)

        requestNotificationPermission()
        startMonitoringService()

        // Session-Ablauf beobachten (401-Interceptor)
        AuthState.sessionExpired.observe(this) { expired ->
            if (expired) {
                AuthState.sessionExpired.value = false
                session.clearSession()
                AppLockManager.lock()
                goToLogin()
            }
        }

        // Lock-Timeout aus Einstellungen laden
        AppLockManager.lockTimeoutMs = session.getLockTimeoutSeconds() * 1000L

        // Deep-link aus Notification
        intent?.getStringExtra("navigate_to")?.let { dest ->
            if (dest == "alerts") navController.navigate(R.id.alertsFragment)
        }
    }

    override fun onStart() {
        super.onStart()
        // App-Sperre prüfen wenn aus Hintergrund zurück
        if (session.isAppLockEnabled() && AppLockManager.onAppForegrounded()) {
            lockLauncher.launch(Intent(this, LockActivity::class.java))
        }
    }

    override fun onStop() {
        super.onStop()
        AppLockManager.onAppBackgrounded()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra("navigate_to")?.let { dest ->
            if (dest == "alerts") {
                val navHost = supportFragmentManager.findFragmentById(R.id.nav_host_fragment) as NavHostFragment
                navHost.navController.navigate(R.id.alertsFragment)
            }
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    100
                )
            }
        }
    }

    private fun startMonitoringService() {
        if (session.isMonitoringEnabled() && !MonitoringService.isRunning) {
            ContextCompat.startForegroundService(
                this,
                Intent(this, MonitoringService::class.java)
                    .setAction(MonitoringService.ACTION_START)
            )
        }
    }

    private fun goToLogin() {
        startActivity(Intent(this, LoginActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        })
    }
}

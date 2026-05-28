package de.roobiin.panel.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.navigation.fragment.NavHostFragment
import androidx.navigation.ui.setupWithNavController
import de.roobiin.panel.R
import de.roobiin.panel.databinding.ActivityMainBinding
import de.roobiin.panel.service.MonitoringService
import de.roobiin.panel.utils.SessionManager

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val navHost = supportFragmentManager.findFragmentById(R.id.nav_host_fragment) as NavHostFragment
        val navController = navHost.navController
        binding.bottomNavigation.setupWithNavController(navController)

        requestNotificationPermission()
        startMonitoringService()

        // Deep-link aus Notification
        intent?.getStringExtra("navigate_to")?.let { dest ->
            if (dest == "alerts") navController.navigate(R.id.alertsFragment)
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
        val session = SessionManager(this)
        if (session.isMonitoringEnabled() && !MonitoringService.isRunning) {
            startForegroundService(
                Intent(this, MonitoringService::class.java)
                    .setAction(MonitoringService.ACTION_START)
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra("navigate_to")?.let { dest ->
            if (dest == "alerts") {
                val navHost = supportFragmentManager.findFragmentById(R.id.nav_host_fragment) as NavHostFragment
                navHost.navController.navigate(R.id.alertsFragment)
            }
        }
    }
}

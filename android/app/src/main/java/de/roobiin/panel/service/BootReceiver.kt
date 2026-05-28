package de.roobiin.panel.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import de.roobiin.panel.utils.SessionManager

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val session = SessionManager(context)
            if (session.isLoggedIn() && session.isMonitoringEnabled()) {
                val serviceIntent = Intent(context, MonitoringService::class.java)
                    .setAction(MonitoringService.ACTION_START)
                context.startForegroundService(serviceIntent)
            }
        }
    }
}

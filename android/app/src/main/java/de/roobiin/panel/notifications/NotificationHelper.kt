package de.roobiin.panel.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import de.roobiin.panel.R
import de.roobiin.panel.ui.MainActivity

object NotificationHelper {

    const val CHANNEL_ALERTS = "alerts"
    const val CHANNEL_MONITORING = "monitoring"

    const val NOTIF_MONITORING_SERVICE = 1001

    fun createChannels(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        NotificationChannel(
            CHANNEL_ALERTS,
            "Alarme",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Benachrichtigungen bei ausgelösten Alarmen"
            enableVibration(true)
            manager.createNotificationChannel(this)
        }

        NotificationChannel(
            CHANNEL_MONITORING,
            "Monitoring-Service",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Hintergrund-Monitoring aktiv"
            manager.createNotificationChannel(this)
        }
    }

    fun showAlertNotification(context: Context, title: String, message: String, id: Int = System.currentTimeMillis().toInt()) {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("navigate_to", "alerts")
        }
        val pendingIntent = PendingIntent.getActivity(
            context, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_alert)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(id, notification)
    }

    fun buildServiceNotification(context: Context) =
        NotificationCompat.Builder(context, CHANNEL_MONITORING)
            .setSmallIcon(R.drawable.ic_monitoring)
            .setContentTitle("Überwachungs-Panel")
            .setContentText("Monitoring aktiv")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .build()
}

package de.roobiin.panel

import android.app.Application
import de.roobiin.panel.notifications.NotificationHelper

class PanelApp : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createChannels(this)
    }
}

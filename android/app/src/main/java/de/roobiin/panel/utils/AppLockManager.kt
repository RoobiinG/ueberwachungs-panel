package de.roobiin.panel.utils

object AppLockManager {

    private var backgroundedAt: Long = 0L
    var isUnlocked: Boolean = false
        private set

    fun onAppForegrounded(): Boolean {
        if (!isUnlocked) return true
        val elapsed = System.currentTimeMillis() - backgroundedAt
        return backgroundedAt > 0L && elapsed > lockTimeoutMs
    }

    fun onAppBackgrounded() {
        backgroundedAt = System.currentTimeMillis()
    }

    fun unlock() {
        isUnlocked = true
        backgroundedAt = 0L
    }

    fun lock() {
        isUnlocked = false
    }

    var lockTimeoutMs: Long = 30_000L
}

package de.roobiin.panel.utils

object AppLockManager {

    @Volatile private var backgroundedAt: Long = 0L
    @Volatile var isUnlocked: Boolean = false
        private set
    @Volatile var lockTimeoutMs: Long = 30_000L

    fun onAppForegrounded(): Boolean {
        if (!isUnlocked) return true
        val snap = backgroundedAt
        if (snap == 0L) return false
        return System.currentTimeMillis() - snap > lockTimeoutMs
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
}

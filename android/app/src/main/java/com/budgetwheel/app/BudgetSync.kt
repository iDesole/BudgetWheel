package com.budgetwheel.app

import android.os.Handler
import android.os.Looper

/** Lets a widget purchase wake the WebView so IndexedDB picks up the new tx. */
object BudgetSync {
    @Volatile
    private var listener: (() -> Unit)? = null

    fun attach(next: () -> Unit) {
        listener = next
    }

    fun detach() {
        listener = null
    }

    fun notifyApp() {
        val cb = listener ?: return
        Handler(Looper.getMainLooper()).post(cb)
    }
}

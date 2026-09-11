package com.budgetwheel.app

import android.app.Activity
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams

/**
 * One-time Play purchase for the home-screen widget. Product id [PRODUCT_ID]
 * must exist in Play Console as a managed product priced $1.99 USD.
 */
class WidgetBilling(
    private val activity: Activity,
    private val store: BudgetStore,
) : PurchasesUpdatedListener {
    var onOwned: ((Boolean) -> Unit)? = null
    var priceLabel: String = "$1.99"
        private set

    private var client: BillingClient? = null
    private var details: ProductDetails? = null
    private var pendingBuy = false

    fun start() {
        if (client != null) return
        val billing = BillingClient.newBuilder(activity)
            .setListener(this)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder().enableOneTimeProducts().build(),
            )
            .build()
        client = billing
        billing.startConnection(
            object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (result.responseCode != BillingClient.BillingResponseCode.OK) return
                    queryProduct()
                    queryOwned()
                }

                override fun onBillingServiceDisconnected() {
                    client = null
                }
            },
        )
    }

    fun stop() {
        pendingBuy = false
        client?.endConnection()
        client = null
    }

    fun refresh() {
        if (client?.isReady == true) queryOwned() else start()
    }

    fun buy() {
        if (store.widgetUnlocked()) {
            onOwned?.invoke(true)
            return
        }
        val ready = client
        val product = details
        if (ready == null || !ready.isReady || product == null) {
            pendingBuy = true
            start()
            return
        }
        val params = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(
                listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(product)
                        .build(),
                ),
            )
            .build()
        val result = ready.launchBillingFlow(activity, params)
        if (result.responseCode == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            markOwned()
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> applyPurchases(purchases.orEmpty())
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> queryOwned()
            else -> Unit
        }
    }

    private fun queryProduct() {
        val ready = client ?: return
        val product = QueryProductDetailsParams.Product.newBuilder()
            .setProductId(PRODUCT_ID)
            .setProductType(BillingClient.ProductType.INAPP)
            .build()
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(product))
            .build()
        ready.queryProductDetailsAsync(params) { result, list ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) return@queryProductDetailsAsync
            val item = list.firstOrNull() ?: return@queryProductDetailsAsync
            details = item
            val formatted = item.oneTimePurchaseOfferDetails?.formattedPrice
            if (!formatted.isNullOrBlank()) priceLabel = formatted
            if (pendingBuy) {
                pendingBuy = false
                activity.runOnUiThread { buy() }
            }
        }
    }

    private fun queryOwned() {
        val ready = client ?: return
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP)
            .build()
        ready.queryPurchasesAsync(params) { result, purchases ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) return@queryPurchasesAsync
            applyPurchases(purchases)
        }
    }

    private fun applyPurchases(purchases: List<Purchase>) {
        val hit = purchases.filter { purchase ->
            purchase.products.contains(PRODUCT_ID) &&
                purchase.purchaseState == Purchase.PurchaseState.PURCHASED
        }
        if (hit.isEmpty()) return
        hit.forEach { acknowledge(it) }
        markOwned()
    }

    private fun acknowledge(purchase: Purchase) {
        if (purchase.isAcknowledged) return
        val ready = client ?: return
        val params = AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(purchase.purchaseToken)
            .build()
        ready.acknowledgePurchase(params) { }
    }

    private fun markOwned() {
        if (store.widgetUnlocked()) {
            activity.runOnUiThread { onOwned?.invoke(true) }
            return
        }
        store.setWidgetUnlocked(true)
        activity.runOnUiThread { onOwned?.invoke(true) }
    }

    companion object {
        const val PRODUCT_ID = "widget_unlock"
        const val EXTRA_UNLOCK = "unlock_widget"
    }
}

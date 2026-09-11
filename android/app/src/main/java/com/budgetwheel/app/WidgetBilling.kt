package com.budgetwheel.app

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.widget.Toast
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
 * Never consumes the item. Promo unlocks stay local and are not cleared.
 */
class WidgetBilling(
    private val activity: Activity,
    private val store: BudgetStore,
) : PurchasesUpdatedListener {
    var onOwned: ((Boolean) -> Unit)? = null
    var priceLabel: String = "$1.99"
        private set

    private val main = Handler(Looper.getMainLooper())
    private var client: BillingClient? = null
    private var details: ProductDetails? = null
    private var offerToken: String? = null
    private var pendingBuy = false
    private var launching = false

    fun start() {
        val existing = client
        if (existing != null) {
            if (existing.isReady) {
                queryProduct()
                queryOwned()
            }
            return
        }
        val billing = BillingClient.newBuilder(activity)
            .setListener(this)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder().enableOneTimeProducts().build(),
            )
            .enableAutoServiceReconnection()
            .build()
        client = billing
        billing.startConnection(
            object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                        if (pendingBuy) failBuy()
                        return
                    }
                    queryProduct()
                    queryOwned()
                }

                override fun onBillingServiceDisconnected() {
                    /* auto-reconnect is enabled */
                }
            },
        )
    }

    fun stop() {
        pendingBuy = false
        launching = false
        client?.endConnection()
        client = null
    }

    fun refresh() {
        if (client?.isReady == true) {
            queryOwned()
            if (details == null) queryProduct()
        } else {
            start()
        }
    }

    fun buy() {
        main.post {
            if (store.widgetUnlocked()) {
                onOwned?.invoke(true)
                return@post
            }
            val ready = client
            val product = details
            if (ready != null && ready.isReady && product != null) {
                launch(ready, product)
                return@post
            }
            pendingBuy = true
            if (ready?.isReady == true) queryProduct() else start()
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        launching = false
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> applyPurchases(purchases.orEmpty())
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> queryOwned()
            BillingClient.BillingResponseCode.USER_CANCELED -> pendingBuy = false
            else -> if (pendingBuy) failBuy()
        }
    }

    private fun launch(ready: BillingClient, product: ProductDetails) {
        if (launching) return
        pendingBuy = false
        val builder = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(product)
        val token = offerToken
        if (token.isNullOrBlank()) {
            failBuy()
            return
        }
        builder.setOfferToken(token)
        launching = true
        val result = ready.launchBillingFlow(
            activity,
            BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(listOf(builder.build()))
                .build(),
        )
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> Unit
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> {
                launching = false
                markOwned()
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> launching = false
            else -> {
                launching = false
                failBuy()
            }
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
        ready.queryProductDetailsAsync(params) { result, queryResult ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                if (pendingBuy) failBuy()
                return@queryProductDetailsAsync
            }
            val item = queryResult.productDetailsList.firstOrNull()
            if (item == null) {
                if (pendingBuy) failBuy()
                return@queryProductDetailsAsync
            }
            details = item
            val offer = item.oneTimePurchaseOfferDetailsList?.firstOrNull()
            offerToken = offer?.offerToken
            val formatted = offer?.formattedPrice
            if (!formatted.isNullOrBlank()) priceLabel = formatted
            if (pendingBuy) {
                pendingBuy = false
                buy()
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
        pendingBuy = false
        launching = false
        if (!store.widgetUnlocked()) store.setWidgetUnlocked(true)
        main.post { onOwned?.invoke(true) }
    }

    private fun failBuy() {
        pendingBuy = false
        launching = false
        main.post {
            Toast.makeText(
                activity,
                "Couldn't start the purchase. Try again.",
                Toast.LENGTH_SHORT,
            ).show()
        }
    }

    companion object {
        const val PRODUCT_ID = "widget_unlock"
        const val EXTRA_UNLOCK = "unlock_widget"
    }
}

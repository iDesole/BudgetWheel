-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class com.budgetwheel.app.MainActivity$Bridge {
    public *;
}
-keep class com.android.vending.billing.** { *; }

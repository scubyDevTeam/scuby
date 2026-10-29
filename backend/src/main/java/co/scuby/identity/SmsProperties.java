package co.scuby.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** scuby.sms.*: throttles per rolling 24 h and the spend alarm threshold (docs/eng/auth.md · OTP mechanics). */
@ConfigurationProperties("scuby.sms")
record SmsProperties(int maxPerNumber, int maxPerDevice, int maxPerIp, int maxPerAccount, int alarmDailySends) {}

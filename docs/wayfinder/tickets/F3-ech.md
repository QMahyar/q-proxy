# F3 — ECH support (in-depth)
Type: task (AFK) · Phase: Features · Order: 3

## Question
Complete ECH: enable toggle + serverName, share-URI params (`ech=`), sing-box/clash fields, validation vs Xray-core fixtures, client-compatibility matrix, QoL hints.

## Answer

DONE (2026-08-25): settings chEnabled+chServerName (validated domain, optional); NodeBase.ech set on TLS nodes at generation (serverName ⊕ sni); emitted as ch= URI param on VLESS/Trojan, singbox tls.ech {enabled}, clash ech-opts {enable}. VMess/SS/Surge/Loon intentionally not (no client convention). Golden key-order preserved (alpn→utls→ech).

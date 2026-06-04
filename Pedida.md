Bien, ahora vamos a realizer una mejora para el apartado de LG.com
Ahora mismo no está tomando data de las landings, en algunas landings temenos promotions id desde AEM que despliegan una especial de PLP con los productos que la conformen.

Esa data llega así:

Request URL
https://www.lg.com/api/graphql
Request Method
POST
Status Code
200 OK
Remote Address
23.222.124.92:443
Referrer Policy
strict-origin-when-cross-origin
accept-ranges
bytes
cache-control
max-age=0, no-cache, no-store
content-encoding
gzip
content-length
339
content-type
application/json
date
Thu, 04 Jun 2026 14:57:07 GMT
expires
Thu, 04 Jun 2026 14:57:07 GMT
pragma
no-cache
server-timing
cdn-cache; desc=MISS
server-timing
edge; dur=30
server-timing
origin; dur=457
server-timing
ak_p; desc="1780585026762_388937167_2176452374_50665_12718_2_0_219";dur=1
strict-transport-security
max-age=31557600
traceresponse
00-18b5e8a5e43b4c4c97c0264285f680dd-4c44f9e80e4146c8-01
vary
Accept-Encoding
x-cache-hits
0, 0, 0
x-content-type-options
nosniff
x-correlation-id
6a219242e22f2470859411
x-debug-info
eyJyZXRyaWVzIjowfQ==
x-frame-options
SAMEORIGIN
x-magento-cache-id
a5d2fcfebeab01352c91b91d32ad363a6d2f3e422aade5dc7b3e9eef8a1bb056
x-platform-server
i-08c828bf4b073c77e
x-platform-server
i-08c828bf4b073c77e
x-served-by
cache-dub4346-DUB, cache-dub4346-DUB, cache-dub4336-DUB, cache-iad-kiad7000141-IAD
x-timer
S1780585027.889671,VS0,VE315
x-xss-protection
1; mode=block
:authority
www.lg.com
:method
POST
:path
/api/graphql
:scheme
https
accept
*/*
accept-encoding
gzip, deflate, br, zstd
accept-language
en-US,en;q=0.9,es-ES;q=0.8,es;q=0.7
cache-control
no-cache
content-length
1166
content-type
application/json
Payload:
{"operationName":"getProductsBySku","variables":{"isSubscription":false,"skuList":["WT13WVTB.DBWPECL.ESCL.CL.C","50NU855BPSA.AWH.ESCL.CL.C","75MRGB85BSC.AWH.ESCL.CL.C","WT19PBTX6.APBPECL.ESCL.CL.C","WT19OBVTB.ANBPECL.ESCL.CL.C","32LR600BPSC.AWHQ.ESCL.CL.C","27G411A-B.AWH.ESCL.CL.C","24G411A-B.AWH.ESCL.CL.C","WD12VVC4S6C.APTPECL.ESCL.CL.C","65UA8050PSA.AWH.ESCL.CL.C","CJ45.DCHLLLX.ESCL.CL.C","GS66SPY.APYPECL.ESCL.CL.C","WT18WVTB.ABWPECL.ESCL.CL.C","VT24BPY.APYPECL.ESCL.CL.C","WK14WS6R.ABWPECL.ESCL.CL.C","GS66SPM.AEPPECL.ESCL.CL.C","GS66BVM.AEPPECL.ESCL.CL.C","GB33BPT.AMCPECL.ESCL.CL.C","S40T.DCHLLLK.ESCL.CL.C","WT23EGTX6.AEGPECL.ESCL.CL.C","27GX704A-B.AWH.ESCL.CL.C","WT9WL.ABWPECL.ESCL.CL.C","WT19DV6.ASFPECL.ESCL.CL.C","DF425HSS.AASPECL.ESCL.CL.C","OLED55C5ESA.AWH.ESCL.CL.C"],"pageSize":25},"query":"query getProductsBySku($skuList:[String]$pageSize:Int$deliveryCoverage:DeliveryCoverageInput$isSubscription:Boolean=false){products(filter:{sku:{in:$skuList}}pageSize:$pageSize delivery_coverage_check:$deliveryCoverage is_subscription:$isSubscription){items{sku ...on PtoV2{items{title options{uid __typename}__typename}__typename}__typename}__typename}}"}
Response:
{
    "data": {
        "products": {
            "items": [
                {
                    "sku": "75MRGB85BSC.AWH.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "50NU855BPSA.AWH.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "27GX704A-B.AWH.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "WT23EGTX6.AEGPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "WT19PBTX6.APBPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "WT13WVTB.DBWPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "GS66SPY.APYPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "WT19OBVTB.ANBPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "27G411A-B.AWH.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "24G411A-B.AWH.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "VT24BPY.APYPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "32LR600BPSC.AWHQ.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "OLED55C5ESA.AWH.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "65UA8050PSA.AWH.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "GS66BVM.AEPPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "GS66SPM.AEPPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "CJ45.DCHLLLX.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "WK14WS6R.ABWPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "WT18WVTB.ABWPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "S40T.DCHLLLK.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "WT9WL.ABWPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "WT19DV6.ASFPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "DF425HSS.AASPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "WD12VVC4S6C.APTPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                },
                {
                    "sku": "GB33BPT.AMCPECL.ESCL.CL",
                    "__typename": "OmdProduct"
                }
            ],
            "__typename": "Products"
        }
    }
}
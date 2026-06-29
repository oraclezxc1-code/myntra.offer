<?php

header("Content-Type: application/json");

function verifyTr($mid, $amount, $transactionId)
{
    $merchant_id  = $mid;
    $merchant_key = $mid; // Replace with real merchant key

    $url = "https://securegw.paytm.in/merchant-status/getTxnStatus?JsonData=";

    $data = [
        'MID'     => $merchant_id,
        'ORDERID' => $transactionId,
    ];

    $json_data = json_encode($data);

    $url .= urlencode($json_data);

    $checksum = hash_hmac('sha256', $json_data, $merchant_key);

    $url .= "&CHECKSUMHASH=" . $checksum;

    // cURL request
    $ch = curl_init($url);

    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);

    $response = curl_exec($ch);

    if (curl_errno($ch)) {
        curl_close($ch);

        return [
            'success' => false,
            'msg' => 'Please try again!'
        ];
    }

    curl_close($ch);

    if (!$response) {
        return [
            'success' => false,
            'msg' => 'No response from server'
        ];
    }

    $response_data = json_decode($response, true);

    $paymentVerified = (
        isset($response_data['STATUS']) &&
        $response_data['STATUS'] === 'TXN_SUCCESS' &&
        $response_data['ORDERID'] === $transactionId &&
        $response_data['MID'] === $merchant_id &&
        isset($response_data['TXNAMOUNT'])
    );

    if ($paymentVerified) {

        $paidAmount = $response_data['TXNAMOUNT'];

        if ((float)$amount != (float)$paidAmount) {

            return [
                'success' => false,
                'msg' => 'Full amount not paid',
                'paid_amount' => $paidAmount
            ];

        } else {

            return [
                'success' => true,
                'amount' => $paidAmount,
                'txn_id' => $transactionId
            ];
        }

    } else {

        return [
            'success' => false,
            'msg' => 'Payment not received'
        ];
    }
}


/*
| Example:
| api.php?mid=YOURMID&amount=100&txn=ORDER123
*/

$mid    = $_GET['mid']    ?? '';
$amount = $_GET['amount'] ?? '';
$txn    = $_GET['txn']    ?? '';

if (empty($mid) || empty($amount) || empty($txn)) {

    echo json_encode([
        'success' => false,
        'msg' => 'Missing parameters'
    ], JSON_PRETTY_PRINT);

    exit;
}

$result = verifyTr($mid, $amount, $txn);

echo json_encode($result, JSON_PRETTY_PRINT);

?>
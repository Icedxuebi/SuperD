SELECT
      pt.id                               AS "Order ID",
      mi.merchant_no                      AS "MID",
      mi.merchant_name_en                 AS "Merchant Name",
      gc_qr.merchant_id                   AS "BillerID",
      pt.payment_date                     AS "Transaction Date",
      pt.merchant_invoice                 AS "Ref1",
      pt.merchant_reference_no            AS "Ref2",
      'Payment'                           AS "Type",
      pt.amount                           AS "Amount",
      ptr.from_account                    AS "Bank Account Number",
      ptr.from_name                       AS "Bank Account Name",
      ptr.from_bank                       AS "Bank Code",
      md.name_en                          AS "Bank Name"
  FROM payment_transaction pt
  JOIN merchant_info mi            ON mi.id = pt.merchant_id
  LEFT JOIN partner_info pi        ON pi.id = mi.partner_id
  LEFT JOIN payment_transaction_response ptr ON ptr.ptx_id = pt.id
  LEFT JOIN gateway_channel gc_qr  ON gc_qr.id = mi.qr_gwc_id
  LEFT JOIN master_data md         ON md.key1 = 'BANK' AND md.key2 = ptr.from_bank AND md.enabled = TRUE
  WHERE mi.merchant_no = 'M250701022505'
    AND pt.payment_date BETWEEN '2026-05-21 00:00:00'::timestamp AND '2026-06-01 23:59:59'::timestamp

  UNION ALL

  SELECT
      tt.id,
      mi.merchant_no,
      mi.merchant_name_en,
      gc_qr.merchant_id,
      tt.transfer_date,
      tt.merchant_invoice,
      tt.merchant_reference_no,
      'Withdraw',
      tt.amount,
      tt.account_no,
      tt.account_holder_name,
      tt.bank_code,
      md.name_en
  FROM transfer_transaction tt
  JOIN merchant_info mi            ON mi.id = tt.merchant_id
  LEFT JOIN partner_info pi        ON pi.id = mi.partner_id
  LEFT JOIN gateway_channel gc_qr  ON gc_qr.id = mi.qr_gwc_id
  LEFT JOIN master_data md         ON md.key1 = 'BANK' AND md.key2 = tt.bank_code AND md.enabled = TRUE
  WHERE mi.merchant_no = 'M250701022505'
    AND tt.transfer_date BETWEEN '2026-05-21 00:00:00'::timestamp AND '2026-06-01 23:59:59'::timestamp

  ORDER BY 6;
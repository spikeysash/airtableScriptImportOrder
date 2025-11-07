// === CONFIG ===
const NEW_ORDER_SKU_TABLE = "new order sku";
const OLD_ORDERS_TABLE = "old-base sync (new orders)";
const ORDERS_TABLE = "orders";
const SUPPLIER_FIELD = "Supplier";
const SUPPLIER_TABLE = "suppliers info";
const SUPPLIER_NAME_FIELD = "Company Name";
const COMPANY_INFO_FIELD = "company info";
const NOTIFY_EMAIL_FIELD = "Notify Email";
const PRODUCT_SHORT_FIELD = "Product short";
const EMAIL_SOURCE_FIELD = "email";
const PRODUCT_NAME_SOURCE_FIELD = "Product name";
const INVOICE_SOURCE_FIELD = "Order Invoice (from Link Orders) copy (from linkOrdersMaster)";
const INVOICE_DEST_FIELD = "invoice";
const PAYMENT_PROOF_SOURCE_FIELD = "payment OLD created (from Link Orders) (from linkOrdersMaster)";
const PAYMENT_PROOF_DEST_FIELD = "payment proof";
const PAYMENT_PERCENT_SOURCE_FIELD = "PAYMENT (from linkOrdersMaster)";
const PAYMENT_AMOUNT_DEST_FIELD = "Payment Amount";
const TOTAL_COST_FIELD = "TotalCost AI";
const PAYMENTS_TABLE = "payments";
const PAYMENT_RELEASED_FIELD = "Payment Released";
const INVOICE_CHECKED_FIELD = "Invoice Checked and Correct";
const IMPORTED_FIELD = "imported";
const STATUS_FIELD = "status";

// === HELPER FUNCTIONS ===
function assertTable(name) {
    const t = base.getTable(name);
    if (!t) throw new Error(`❌ Table "${name}" not found`);
    return t;
}
const oldOrdersTable = assertTable(OLD_ORDERS_TABLE);
const newOrderSkuTable = assertTable(NEW_ORDER_SKU_TABLE);
const ordersTable = assertTable(ORDERS_TABLE);
const supplierTable = assertTable(SUPPLIER_TABLE);
const paymentsTable = assertTable(PAYMENTS_TABLE);

// === INPUT RECORD ===
let inputRecord = await input.recordAsync("Select an order to import", oldOrdersTable);
if (!inputRecord) return output.text("❌ No record selected.");

let orderNumber = inputRecord.getCellValue("order #");
if (!orderNumber) return output.text("❌ No order # found.");

output.text(`📦 Importing all items for order ${orderNumber}...`);

// === FETCH MATCHING RECORDS ===
let query = await oldOrdersTable.selectRecordsAsync({
    fields: ["order #", "sku clean", "U/Ord", "company name", COMPANY_INFO_FIELD, EMAIL_SOURCE_FIELD, PRODUCT_NAME_SOURCE_FIELD, INVOICE_SOURCE_FIELD, PAYMENT_PROOF_SOURCE_FIELD, PAYMENT_PERCENT_SOURCE_FIELD, IMPORTED_FIELD]
});
let matching = query.records.filter(r => String(r.getCellValue("order #")) === String(orderNumber));
if (matching.length === 0) return output.text(`⚠️ No SKUs found for ${orderNumber}.`);

// Get attachments and payment info from the first record (all records in the order should have the same data)
const invoiceAttachment = matching[0].getCellValue(INVOICE_SOURCE_FIELD);
const paymentProofAttachment = matching[0].getCellValue(PAYMENT_PROOF_SOURCE_FIELD);
const paymentPercentRaw = matching[0].getCellValue(PAYMENT_PERCENT_SOURCE_FIELD);

if (invoiceAttachment) {
    output.text(`📎 Found invoice attachment for this order`);
}
if (paymentProofAttachment) {
    output.text(`💳 Found payment proof attachment for this order`);
}
if (paymentPercentRaw) {
    output.text(`💰 Found payment percentage: ${JSON.stringify(paymentPercentRaw)}`);
}

// === LOAD EXISTING SUPPLIERS ===
output.text(`\n🔍 CHECKING SUPPLIERS INFO TABLE FIELDS...`);
for (const field of supplierTable.fields) {
    const readOnly = field.isComputed ? " [READ-ONLY/COMPUTED]" : "";
    output.text(`  - "${field.name}" (${field.type})${readOnly}`);
}

// Find writable text fields
const writableFields = supplierTable.fields.filter(f => 
    !f.isComputed && (f.type === "multilineText" || f.type === "richText" || f.type === "singleLineText")
);
output.text(`\n📝 WRITABLE TEXT FIELDS:`);
for (const field of writableFields) {
    output.text(`  ✓ "${field.name}" (${field.type})`);
}

let supplierQuery = await supplierTable.selectRecordsAsync({ fields: [SUPPLIER_NAME_FIELD] });
let supplierMap = new Map();
for (let rec of supplierQuery.records) {
    const n = (rec.getCellValue(SUPPLIER_NAME_FIELD) || "").toString().trim().toLowerCase();
    if (n) supplierMap.set(n, rec.id);
}

// === NORMALIZE TO CLEAN STRING OR NUMBER ===
function normalizeToString(value) {
    if (!value && value !== 0) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return String(value);
    if (Array.isArray(value)) {
        if (value.length === 0) return "";
        const first = value[0];
        // Check if it's an object with 'name' property (linked record)
        if (typeof first === "object" && first !== null && first.name) {
            return String(first.name).trim();
        }
        // Check for Airtable generated value format
        if (typeof first === "object" && first !== null && first.value) {
            return String(first.value).trim();
        }
        // If it's just a string or number in the array
        if (typeof first === "string") return first.trim();
        if (typeof first === "number") return String(first);
        // Otherwise, we can't extract a valid string - return empty
        return "";
    }
    // Check for Airtable generated value format: {state:"generated", value:"...", isStale:false}
    if (typeof value === "object" && value !== null && value.value) {
        return String(value.value).trim();
    }
    if (typeof value === "object" && value !== null && value.name) {
        return String(value.name).trim();
    }
    // Fallback: if it's still an object, return empty (don't stringify objects)
    if (typeof value === "object") return "";
    return String(value).trim();
}

function normalizeToNumber(value) {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
    }
    if (Array.isArray(value) && value.length > 0) {
        return normalizeToNumber(value[0]);
    }
    if (typeof value === "object" && value !== null && value.name) {
        return normalizeToNumber(value.name);
    }
    return null;
}

function normalizePercentage(value) {
    // Handle percentage strings like "30%" or arrays containing them
    if (typeof value === "string") {
        // Remove % sign and whitespace
        const cleaned = value.replace(/[%\s]/g, "");
        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed)) {
            // Convert percentage to decimal (30 -> 0.3)
            return parsed / 100;
        }
    }
    if (Array.isArray(value) && value.length > 0) {
        return normalizePercentage(value[0]);
    }
    // If it's already a number, assume it's in decimal format
    if (typeof value === "number") {
        // If it's > 1, assume it's a percentage that needs conversion
        return value > 1 ? value / 100 : value;
    }
    return normalizeToNumber(value);
}

// === FIND OR CREATE SUPPLIER ===
async function getSupplierIdByName(rawValue, companyInfoRaw, emailRaw, productNameRaw) {
    const name = normalizeToString(rawValue);
    if (!name) {
        output.text(`⚠️ No supplier name found (raw value: ${JSON.stringify(rawValue)})`);
        return null;
    }
    const key = name.toLowerCase();

    if (supplierMap.has(key)) {
        output.text(`✓ Found existing supplier: ${name}`);
        return supplierMap.get(key);
    }

    output.text(`🆕 Creating new supplier: ${name}`);
    
    try {
        // Build fields object
        const fields = { [SUPPLIER_NAME_FIELD]: name };
        
        // Add company info from source
        if (companyInfoRaw) {
            output.text(`   Company info raw type: ${typeof companyInfoRaw}`);
            output.text(`   Company info is array: ${Array.isArray(companyInfoRaw)}`);
            
            // Check if it's attachments (array with url property)
            if (Array.isArray(companyInfoRaw) && companyInfoRaw.length > 0) {
                if (companyInfoRaw[0].url) {
                    // It's attachments - copy directly
                    fields[COMPANY_INFO_FIELD] = companyInfoRaw;
                    output.text(`   ✓ Adding ${companyInfoRaw.length} attachment(s)`);
                } else {
                    // Array of strings - join them
                    const text = companyInfoRaw.map(item => normalizeToString(item)).filter(s => s).join(", ");
                    if (text) {
                        fields[COMPANY_INFO_FIELD] = text;
                        output.text(`   ✓ Adding text: ${text}`);
                    }
                }
            } else if (typeof companyInfoRaw === 'string') {
                // Plain text
                fields[COMPANY_INFO_FIELD] = companyInfoRaw;
                output.text(`   ✓ Adding text: ${companyInfoRaw}`);
            } else {
                // Try to normalize
                const normalized = normalizeToString(companyInfoRaw);
                if (normalized) {
                    fields[COMPANY_INFO_FIELD] = normalized;
                    output.text(`   ✓ Adding normalized: ${normalized}`);
                }
            }
        }
        
        // Add email if available
        if (emailRaw) {
            const email = normalizeToString(emailRaw);
            if (email) {
                fields[NOTIFY_EMAIL_FIELD] = email;
                output.text(`   ✓ Adding email: ${email}`);
            }
        }
        
        // Add product short if available
        if (productNameRaw) {
            const productShort = normalizeToString(productNameRaw);
            if (productShort) {
                fields[PRODUCT_SHORT_FIELD] = productShort;
                output.text(`   ✓ Adding product short: ${productShort}`);
            }
        }
        
        const newId = await supplierTable.createRecordAsync(fields);
        supplierMap.set(key, newId);
        output.text(`✅ Created supplier with ID: ${newId}`);
        return newId;
    } catch (e) {
        output.text(`❌ Failed to create supplier "${name}": ${e.message}`);
        return null;
    }
}

// === CREATE NEW SKU RECORDS ===
let newRecords = [];
output.text(`🔍 Processing ${matching.length} SKU line items...`);
for (let i = 0; i < matching.length; i++) {
    const r = matching[i];
    const skuRaw = r.getCellValue("sku clean");
    const qtyRaw = r.getCellValue("U/Ord");
    const supplierNameRaw = r.getCellValue("company name");
    const companyInfoRaw = r.getCellValue(COMPANY_INFO_FIELD);
    const emailRaw = r.getCellValue(EMAIL_SOURCE_FIELD);
    const productNameRaw = r.getCellValue(PRODUCT_NAME_SOURCE_FIELD);
    
    // Debug output for each record
    output.text(`\n--- Record ${i + 1}/${matching.length} ---`);
    output.text(`Raw company name: ${JSON.stringify(supplierNameRaw)}`);
    output.text(`Raw email: ${JSON.stringify(emailRaw)}`);
    output.text(`Raw product name: ${JSON.stringify(productNameRaw)}`);
    
    // Normalize all values to prevent [object Object] errors
    const sku = normalizeToString(skuRaw);
    const qty = normalizeToNumber(qtyRaw);
    const supplierName = normalizeToString(supplierNameRaw);
    const email = normalizeToString(emailRaw);
    const productName = normalizeToString(productNameRaw);
    
    output.text(`Normalized: SKU="${sku}", Qty=${qty}, Supplier="${supplierName}", Product="${productName}"`);
    
    const supplierId = await getSupplierIdByName(supplierNameRaw, companyInfoRaw, emailRaw, productNameRaw);
    output.text(`Supplier ID: ${supplierId}`);
    
    // Build fields object, only including valid values
    const fields = {};
    if (sku) fields.sku = sku;
    if (qty !== null) fields["quantity requested"] = qty;
    if (supplierId) fields[SUPPLIER_FIELD] = [{ id: supplierId }];

    newRecords.push({ fields });
}

// === CREATE IN BATCHES ===
let createdRecordIds = [];
output.text(`📋 Preparing to create ${newRecords.length} SKU records...`);

// Validate all records before attempting creation
for (let i = 0; i < newRecords.length; i++) {
    const rec = newRecords[i];
    if (!rec || typeof rec !== "object") {
        output.text(`⚠️ Record ${i} is invalid: ${typeof rec}`);
    } else if (!rec.fields || typeof rec.fields !== "object") {
        output.text(`⚠️ Record ${i} has invalid fields: ${JSON.stringify(rec)}`);
    }
}

while (newRecords.length) {
    const batch = newRecords.slice(0, 50);
    try {
        const result = await newOrderSkuTable.createRecordsAsync(batch);
        // Airtable returns array of record IDs as strings
        if (Array.isArray(result)) {
            for (let rec of result) {
                const id = typeof rec === "string" ? rec : (rec?.id || rec);
                if (id) createdRecordIds.push(id);
            }
        }
        newRecords = newRecords.slice(50);
    } catch (e) {
        output.text(`❌ Error creating records: ${e.message}`);
        output.text(`📦 First record in failed batch: ${JSON.stringify(batch[0], null, 2)}`);
        throw e;
    }
}
output.text(`✅ Created ${createdRecordIds.length} SKU records.`);
output.text(`📊 Sample IDs: ${createdRecordIds.slice(0, 3).join(", ")}`);

// Wait a moment for Airtable to process the new records
output.text("⏳ Waiting 2 seconds for records to sync...");
await new Promise(r => setTimeout(r, 2000));

// === UPDATE STATUS ===
output.text(`\n🔄 Updating status to 'approved' for ${createdRecordIds.length} records...`);

if (createdRecordIds.length > 0) {
    try {
        // Query the newly created records to get fresh record objects
        const freshQuery = await newOrderSkuTable.selectRecordsAsync();
        const freshRecords = freshQuery.records.filter(rec => createdRecordIds.includes(rec.id));
        
        output.text(`Found ${freshRecords.length} fresh records to update`);
        
        // Try updating them one by one with the record objects
        // For single select fields, must use {name: "value"} format
        let successCount = 0;
        for (const record of freshRecords) {
            try {
                const updateData = { "status": { name: "approved" } };
                output.text(`Sending update: ${JSON.stringify(updateData)}`);
                
                await newOrderSkuTable.updateRecordAsync(record, updateData);
                successCount++;
                output.text(`✓ Updated ${record.id}`);
            } catch (err) {
                output.text(`❌ Failed ${record.id}: ${err.message}`);
            }
        }
        
        output.text(`✅ Successfully updated ${successCount}/${freshRecords.length} records.`);
    } catch (e) {
        output.text(`❌ Error updating status: ${e.message}`);
    }
} else {
    output.text("⚠️ No records to update!");
}

// === MARK IMPORTED ===
for (let r of matching) await oldOrdersTable.updateRecordAsync(r.id, { [IMPORTED_FIELD]: true });
output.text("☑️ Source records marked as imported.");

// === WAIT FOR AUTOMATION ===
output.text("⏳ Waiting 5 seconds for order automation...");
output.text("   (This allows the automation to create the order record)");
await new Promise(r => setTimeout(r, 5000));
output.text("   ✓ Wait complete");

// === UPDATE ORDER#OVERRIDE ===
output.text(`\n📋 Looking for most recent order record...`);

// Find the order#override field
const overrideField = ordersTable.fields.find(f => f.name.toLowerCase().includes("override") && !f.name.toLowerCase().includes("checked"));
output.text(`Override field found: ${overrideField?.name || "NOT FOUND"}`);

// Store order record ID for later use in payment calculation
let orderRecordId = null;

if (overrideField) {
    // Query orders table and sort by ID descending (most recent first)
    const ordersQuery = await ordersTable.selectRecordsAsync({
        sorts: [{ field: "ID", direction: "desc" }]
    });
    
    output.text(`Found ${ordersQuery.records.length} records in orders table`);
    
    if (ordersQuery.records.length > 0) {
        const mostRecentOrder = ordersQuery.records[0];
        orderRecordId = mostRecentOrder.id;
        
        output.text(`Most recent order ID: ${mostRecentOrder.id}`);
        
        try {
            // Build update object
            const updateFields = { 
                [overrideField.name]: String(orderNumber) 
            };
            
            // Add invoice attachment if available
            if (invoiceAttachment && Array.isArray(invoiceAttachment) && invoiceAttachment.length > 0) {
                if (invoiceAttachment[0].url) {
                    updateFields[INVOICE_DEST_FIELD] = invoiceAttachment;
                    output.text(`📎 Adding ${invoiceAttachment.length} invoice attachment(s)`);
                }
            }
            
            await ordersTable.updateRecordAsync(mostRecentOrder.id, updateFields);
            output.text(`🔄 Updated ${overrideField.name} to "${orderNumber}" on record ${mostRecentOrder.id}`);
            
            if (updateFields[INVOICE_DEST_FIELD]) {
                output.text(`✅ Invoice attachment copied to orders table`);
            }
            
            // Wait before second update
            output.text("\n⏳ Waiting 3 seconds before marking invoice as checked...");
            output.text("   (Allowing order fields to settle before triggering AI)");
            await new Promise(r => setTimeout(r, 3000));
            output.text("   ✓ Wait complete");
            
            // Second separate update: mark invoice as checked (triggers automation)
            try {
                await ordersTable.updateRecordAsync(mostRecentOrder.id, {
                    [INVOICE_CHECKED_FIELD]: true
                });
                output.text(`✅ Marked "${INVOICE_CHECKED_FIELD}" checkbox on record ${mostRecentOrder.id}`);
            } catch (e) {
                output.text(`❌ Failed to mark invoice as checked: ${e.message}`);
            }
            
        } catch (e) {
            output.text(`❌ Failed to update order record: ${e.message}`);
        }
    } else {
        output.text("⚠️ No records found in orders table");
    }
} else {
    output.text("⚠️ order#override field not found in orders table");
}

// === WAIT FOR PAYMENT AUTOMATION & AI CALCULATION ===
output.text("\n⏳ Waiting 30 seconds for payment automation and AI cost calculation...");
output.text("   (This allows the AI to analyze the invoice and calculate TotalCost AI)");
for (let i = 1; i <= 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (i % 5 === 0) {
        output.text(`   ... ${i} seconds elapsed ...`);
    }
}
output.text("   ✓ Wait complete");

// === GET TOTAL COST AI ===
let totalCostAI = null;
if (orderRecordId) {
    output.text(`\n💰 Fetching TotalCost AI from order ${orderRecordId}...`);
    try {
        const orderRecord = await ordersTable.selectRecordAsync(orderRecordId);
        totalCostAI = orderRecord.getCellValue(TOTAL_COST_FIELD);
        output.text(`TotalCost AI value: ${totalCostAI !== null ? totalCostAI : "NOT CALCULATED YET"}`);
    } catch (e) {
        output.text(`⚠️ Could not read order record: ${e.message}`);
    }
}

// === UPDATE PAYMENT PROOF ===
if (paymentProofAttachment && Array.isArray(paymentProofAttachment) && paymentProofAttachment.length > 0 && paymentProofAttachment[0].url) {
    output.text(`\n💳 Looking for payment record with Order#: ${orderNumber}...`);
    
    // Debug: Show payments table fields
    output.text(`\nPayments table fields:`);
    for (const field of paymentsTable.fields) {
        if (field.name.toLowerCase().includes("amount") || field.name.toLowerCase().includes("payment")) {
            output.text(`  - "${field.name}" (${field.type})`);
        }
    }
    
    try {
        // Query payments table for matching order# text field
        const paymentsQuery = await paymentsTable.selectRecordsAsync({
            fields: ["order# text"]
        });
        
        // Find payment record with matching order# text
        const paymentMatch = paymentsQuery.records.find(r => {
            const cellValue = r.getCellValue("order# text");
            const match = String(cellValue) === String(orderNumber);
            if (match) {
                output.text(`✓ Found payment with order# text: ${cellValue}`);
            }
            return match;
        });
        
        if (paymentMatch) {
            output.text(`✓ Found payment record: ${paymentMatch.id}`);
            
            // Build payment update object
            const paymentUpdateFields = {
                [PAYMENT_PROOF_DEST_FIELD]: paymentProofAttachment,
                [PAYMENT_RELEASED_FIELD]: true
            };
            
            // Calculate payment amount if we have percentage and total cost
            output.text(`\n📊 Payment calculation debug:`);
            output.text(`  - Payment % raw: ${JSON.stringify(paymentPercentRaw)}`);
            output.text(`  - TotalCost AI: ${totalCostAI}`);
            
            if (paymentPercentRaw && totalCostAI !== null) {
                const paymentPercent = normalizePercentage(paymentPercentRaw);
                const totalCost = normalizeToNumber(totalCostAI);
                
                output.text(`  - Payment % normalized: ${paymentPercent} (as decimal)`);
                output.text(`  - TotalCost normalized: ${totalCost}`);
                
                if (paymentPercent !== null && totalCost !== null) {
                    const paymentAmount = totalCost * paymentPercent;
                    paymentUpdateFields[PAYMENT_AMOUNT_DEST_FIELD] = paymentAmount;
                    output.text(`💰 Calculated payment amount: ${totalCost} × ${paymentPercent} = ${paymentAmount}`);
                } else {
                    output.text(`⚠️ Could not normalize payment values`);
                }
            } else {
                output.text(`⚠️ Missing payment percentage or TotalCost AI for calculation`);
            }
            
            await paymentsTable.updateRecordAsync(paymentMatch.id, paymentUpdateFields);
            
            output.text(`💳 Updated payment proof with ${paymentProofAttachment.length} attachment(s)`);
            output.text(`✅ Payment proof copied to payments table`);
            output.text(`✅ Marked "Payment Released" checkbox`);
            if (paymentUpdateFields[PAYMENT_AMOUNT_DEST_FIELD]) {
                output.text(`✅ Set payment amount: ${paymentUpdateFields[PAYMENT_AMOUNT_DEST_FIELD]}`);
            }
        } else {
            output.text(`⚠️ No payment record found for order ${orderNumber}`);
        }
    } catch (e) {
        output.text(`❌ Failed to update payment proof: ${e.message}`);
    }
} else {
    output.text(`\n⚠️ No payment proof attachment found in source`);
}

output.text("\n🎉 Import process complete!");

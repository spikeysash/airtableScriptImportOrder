# Airtable Order Import Script

## Overview
This Airtable scripting block automation imports orders from the "old-base sync (new orders)" table into the new order management system.

## What It Does

1. **Imports Order Items**: Takes all SKU line items for a selected order number and creates them in the "new order sku" table
2. **Creates/Links Suppliers**: Automatically creates supplier records in "suppliers info" if they don't exist, including copying company info attachments
3. **Updates Status**: Sets all imported SKU records to "approved" status
4. **Marks as Imported**: Updates source records with imported checkbox
5. **Updates Order Override**: After automation creates the order record, updates the order#override field with the correct order number

## Tables Used

- **old-base sync (new orders)**: Source table with incoming orders
- **new order sku**: Destination for SKU line items
- **suppliers info**: Master supplier list
- **orders**: Order summary records (created by automation)

## Key Features

- ✅ Handles Airtable generated lookup values
- ✅ Copies attachment files from company info field
- ✅ Prevents duplicate supplier creation
- ✅ Updates single-select fields with proper format
- ✅ Batch processing for performance
- ✅ Comprehensive error handling and debug output

## How to Use

1. Open the scripting block in your Airtable base
2. Click the "Import Order" button on any record in "old-base sync (new orders)"
3. The script will automatically process all SKUs for that order number
4. Wait for completion message

## Configuration

Key constants at the top of the script can be adjusted:
- Table names
- Field names
- Wait times for automation triggers

## Version History

- **v1.0** (2025-01-13): Initial working version with full functionality


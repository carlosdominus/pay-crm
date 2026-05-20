# Security Specification - Dominus CRM

## Data Invariants
1. A **UserTag** must be associated with a valid `clientKey` and belong to the authenticated user.
2. A **ManualSale** must belong to the authenticated user and have a valid `clientKey`.
3. Users can only access their own data (sales and tags) under `/users/{userId}/`.
4. Timestamps (`updatedAt` and `createdAt`) must be validated against `request.time` where applicable.

## The "Dirty Dozen" Payloads (Denial Tests)

1. **Identity Spoofing**: Attempt to create a sale for a different user ID.
   - Path: `/users/attacker_id/sales/sale_1`
   - Payload: `{ "clientKey": "client_1", "productName": "VIP", "value": 100, "commission": 50, "date": "2023-10-01", "timestamp": 1696118400000, "ownerId": "victim_id" }`
   - Expected: `PERMISSION_DENIED`

2. **Cross-User Access**: Attempt to read another user's tags.
   - Path: `/users/victim_id/tags/client_1`
   - Expected: `PERMISSION_DENIED`

3. **Invalid Document ID**: Attempt to create a sale with a 2KB long ID.
   - Path: `/users/{uid}/sales/` + "A" * 2048
   - Expected: `PERMISSION_DENIED` (due to `isValidId` check)

4. **Shadow Field Injection**: Attempt to create a tag with an undocumented `isAdmin` field.
   - Path: `/users/{uid}/tags/client_1`
   - Payload: `{ "clientKey": "client_1", "tag": "vendido", "updatedAt": "...", "isAdmin": true }`
   - Expected: `PERMISSION_DENIED` (due to strict key check)

5. **Type Poisoning**: Sending a string for a numeric `value` in a sale.
   - Payload: `{ ..., "value": "100" }`
   - Expected: `PERMISSION_DENIED`

6. **Missing Required Fields**: Creating a sale without `productName`.
   - Expected: `PERMISSION_DENIED`

7. **Immortal Field Modification**: Attempt to change `clientKey` on an existing sale.
   - Expected: `PERMISSION_DENIED`

8. **Future Timestamp**: Setting `updatedAt` to a future date instead of `request.time`.
   - Expected: `PERMISSION_DENIED`

9. **Unauthenticated Write**: Attempting to write to any collection without a valid JWT.
   - Expected: `PERMISSION_DENIED`

10. **Query Scraping**: Attempting to list all users' sales.
    - Path: `/users`
    - Expected: `PERMISSION_DENIED`

11. **ID Poisoning in Path**: Injecting special characters in the `clientKey` within the path.
    - Expected: `PERMISSION_DENIED`

12. **Negative Value**: Setting a negative `value` or `commission` for a sale.
    - Expected: `PERMISSION_DENIED`

## Test Runner (firestore.rules.test.ts)
(This file will be generated next)

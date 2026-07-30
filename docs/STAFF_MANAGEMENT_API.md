# Staff Management API Documentation

This document outlines the API endpoints for managing staff members in the system. These endpoints allow admin users to manage staff members and their business assignments.

## Base URL
All API endpoints are prefixed with `/api/admin/staff`

## Authentication
All endpoints require authentication. Include a valid JWT token in the `Authorization` header.

## Endpoints

### 1. Add New Staff Member
**Endpoint:** `POST /`
**Access:** Admin only

**Request Body:**
```json
{
  "userId": "60d5ec9f8b3f8b3f8b3f8b3f",
  "businesses": ["60d5ec9f8b3f8b3f8b3f8b3f", "60d5ec9f8b3f8b3f8b3f8b3g"],
  "role": "STAFF",
  "permissions": ["VIEW_LEADS", "MANAGE_LEADS"]
}
```

**Success Response (201):**
```json
{
  "status": true,
  "message": "Staff added successfully",
  "data": {
    "_id": "60d5ec9f8b3f8b3f8b3f8b3f",
    "userId": "60d5ec9f8b3f8b3f8b3f8b3f",
    "businesses": ["60d5ec9f8b3f8b3f8b3f8b3f", "60d5ec9f8b3f8b3f8b3f8b3g"],
    "role": "STAFF",
    "permissions": ["VIEW_LEADS", "MANAGE_LEADS"],
    "isActive": true,
    "createdBy": "60d5ec9f8b3f8b3f8b3f8b3a"
  }
}
```

### 2. Get All Staff Members
**Endpoint:** `GET /`
**Access:** Admin only

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 10)
- `search` - Search term (searches name, email, mobile)
- `role` - Filter by role (STAFF, MANAGER, ADMIN)
- `isActive` - Filter by active status (true/false)

**Success Response (200):**
```json
{
  "status": true,
  "data": [
    {
      "_id": "60d5ec9f8b3f8b3f8b3f8b3f",
      "userId": {
        "_id": "60d5ec9f8b3f8b3f8b3f8b3f",
        "name": "John Doe",
        "email": "john@example.com",
        "mobile": "9876543210"
      },
      "businesses": [
        {
          "_id": "60d5ec9f8b3f8b3f8b3f8b3f",
          "businessName": "Example Business"
        }
      ],
      "role": "STAFF",
      "isActive": true
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "totalPages": 1
  }
}
```

### 3. Get Staff Member by ID
**Endpoint:** `GET /:staffId`
**Access:** Admin or the staff member themselves

**Success Response (200):**
```json
{
  "status": true,
  "data": {
    "_id": "60d5ec9f8b3f8b3f8b3f8b3f",
    "userId": {
      "_id": "60d5ec9f8b3f8b3f8b3f8b3f",
      "name": "John Doe",
      "email": "john@example.com",
      "mobile": "9876543210"
    },
    "businesses": [
      {
        "_id": "60d5ec9f8b3f8b3f8b3f8b3f",
        "businessName": "Example Business",
        "businessType": "Retail"
      }
    ],
    "role": "STAFF",
    "permissions": ["VIEW_LEADS", "MANAGE_LEADS"],
    "isActive": true
  }
}
```

### 4. Update Staff Member
**Endpoint:** `PUT /:staffId`
**Access:** Admin only

**Request Body:**
```json
{
  "businesses": ["60d5ec9f8b3f8b3f8b3f8b3f"],
  "role": "MANAGER",
  "permissions": ["VIEW_LEADS", "MANAGE_LEADS", "VIEW_ANALYTICS"],
  "isActive": true
}
```

**Success Response (200):**
```json
{
  "status": true,
  "message": "Staff updated successfully",
  "data": {
    "_id": "60d5ec9f8b3f8b3f8b3f8b3f",
    "userId": "60d5ec9f8b3f8b3f8b3f8b3f",
    "businesses": ["60d5ec9f8b3f8b3f8b3f8b3f"],
    "role": "MANAGER",
    "permissions": ["VIEW_LEADS", "MANAGE_LEADS", "VIEW_ANALYTICS"],
    "isActive": true
  }
}
```

### 5. Delete Staff Member (Soft Delete)
**Endpoint:** `DELETE /:staffId`
**Access:** Admin only

**Success Response (200):**
```json
{
  "status": true,
  "message": "Staff deactivated successfully"
}
```

### 6. Get Staff's Assigned Businesses
**Endpoint:** `GET /:staffId/businesses`
**Access:** Admin or the staff member themselves

**Success Response (200):**
```json
{
  "status": true,
  "data": [
    {
      "_id": "60d5ec9f8b3f8b3f8b3f8b3f",
      "businessName": "Example Business",
      "businessType": "Retail",
      "address": "123 Main St",
      "city": "Mumbai",
      "state": "Maharashtra",
      "country": "India"
    }
  ]
}
```

## Error Responses

### 403 Forbidden
```json
{
  "status": false,
  "message": "Only admin can perform this action"
}
```

### 404 Not Found
```json
{
  "status": false,
  "message": "Staff not found"
}
```

### 500 Internal Server Error
```json
{
  "status": false,
  "message": "Server error",
  "error": "Error message details"
}
```

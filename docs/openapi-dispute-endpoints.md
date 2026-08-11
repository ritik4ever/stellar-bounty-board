# OpenAPI Spec — Dispute & Resolution Endpoints

## POST /api/disputes

Create a new dispute for a bounty.

\`\`\`yaml
/api/disputes:
  post:
    summary: Create a dispute
    tags: [Disputes]
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            properties:
              bountyId:
                type: string
              reason:
                type: string
              evidence:
                type: array
                items:
                  type: string
    responses:
      201:
        description: Dispute created
      400:
        description: Invalid input
\`\`\`

## GET /api/disputes/:id

Get dispute details.

\`\`\`yaml
/api/disputes/{id}:
  get:
    summary: Get dispute details
    tags: [Disputes]
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
    responses:
      200:
        description: Dispute details
      404:
        description: Dispute not found
\`\`\`

## POST /api/disputes/:id/resolve

Resolve a dispute (milestone or maintainer only).

\`\`\`yaml
/api/disputes/{id}/resolve:
  post:
    summary: Resolve a dispute
    tags: [Disputes]
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            properties:
              resolution:
                type: string
                enum: [in_favor_of_creator, in_favor_of_submitter, split]
              notes:
                type: string
    responses:
      200:
        description: Dispute resolved
\`\`\`

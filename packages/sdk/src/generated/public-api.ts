/**
 * Purpose: Generated TypeScript contract types for the public CDNgine API surface.
 * Governing docs:
 * - docs/sdk-strategy.md
 * - docs/spec-governance.md
 * - docs/api-surface.md
 * External references:
 * - https://spec.openapis.org/oas/latest.html
 * - https://openapi-ts.dev/
 * Tests:
 * - packages/sdk/test/public-client.test.mjs
 */

export interface paths {
    "/v1/upload-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create an upload session
         * @description Creates a staged upload session for either a new logical asset or a new immutable
         *     version of an existing asset. Retries with the same idempotency key converge on the
         *     same session and version intent.
         */
        post: operations["createUploadSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/upload-sessions/{uploadSessionId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Complete an upload session
         * @description Verifies that staged bytes are durably present and requests the canonicalization
         *     handoff. Successful completion returns the immutable version handle and the
         *     workflow-dispatch status view instead of pretending processing is synchronous.
         */
        post: operations["completeUploadSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{assetId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a logical asset
         * @description Returns logical-asset metadata plus the latest known immutable version reference.
         *     Asset identity remains stable while versions advance.
         */
        get: operations["getAsset"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{assetId}/versions/{versionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an immutable asset version
         * @description Returns explicit lifecycle, source, and processing state for one immutable version.
         */
        get: operations["getAssetVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{assetId}/versions/{versionId}/source/authorize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Authorize original-source access
         * @description Returns a resolved source-delivery posture such as a temporary export URL, a proxy
         *     path, or a tightly scoped lazy-read handle for trusted internal clients.
         */
        post: operations["authorizeSourceDownload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{assetId}/versions/{versionId}/derivatives": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List deterministic derivatives
         * @description Lists the currently published deterministic derivatives for a version.
         */
        get: operations["listDerivatives"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{assetId}/versions/{versionId}/manifests/{manifestType}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a published manifest
         * @description Returns a published manifest for the requested version and manifest type.
         */
        get: operations["getManifest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{assetId}/versions/{versionId}/deliveries/{deliveryScopeId}/authorize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Authorize derivative delivery
         * @description Resolves the caller-facing delivery mode for a specific delivery scope without
         *     requiring the client to understand which cache, bucket, or origin served the result.
         */
        post: operations["authorizeDelivery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** UploadSessionCreateRequest */
        "upload-session-create-request.schema": {
            serviceNamespaceId: string;
            tenantId?: string;
            /** @description Include to create a new immutable version of an existing logical asset. */
            assetId?: string;
            assetOwner: string;
            source: {
                filename: string;
                contentType: string;
            };
            upload: {
                objectKey: string;
                byteLength: number;
                checksum: {
                    /** @enum {string} */
                    algorithm: "sha256";
                    value: string;
                };
            };
        };
        /** ProblemDetail */
        "problem-detail.schema": {
            type: string;
            title: string;
            status: number;
            detail: string;
            instance?: string;
            retryable: boolean;
            assetId?: string;
            versionId?: string;
            workflowId?: string;
        } & {
            [key: string]: unknown;
        };
        /** UploadSessionCreateResponse */
        "upload-session-create-response.schema": {
            uploadSessionId: string;
            assetId: string;
            versionId: string;
            isDuplicate: boolean;
            uploadTarget: {
                /** @enum {string} */
                protocol: "tus";
                /** @enum {string} */
                method: "PATCH";
                url: string;
                expiresAt: string;
            };
            /** @enum {string} */
            status: "awaiting-upload";
            links: {
                complete: string;
                version: string;
            };
        };
        /** UploadSessionCompleteResponse */
        "upload-session-complete-response.schema": {
            uploadSessionId: string;
            assetId: string;
            versionId: string;
            /** @enum {string} */
            versionState: "canonical" | "processing";
            workflowDispatch: {
                dispatchId: string;
                /** @enum {string} */
                state: "pending" | "starting" | "started" | "duplicate" | "failed_retryable" | "failed_terminal";
                workflowKey: string;
            };
            links: {
                version: string;
            };
        };
        /** AssetVersion */
        "asset-version.schema": {
            assetId: string;
            versionId: string;
            serviceNamespaceId: string;
            tenantId?: string;
            assetOwner: string;
            versionNumber: number;
            /** @enum {string} */
            lifecycleState: "awaiting-upload" | "canonicalizing" | "canonical" | "processing" | "published" | "quarantined";
            /** @enum {string} */
            workflowState: "pending" | "running" | "completed" | "failed" | "not-dispatched";
            source: {
                contentType: string;
                filename: string;
                byteLength: number;
            };
            links: {
                self: string;
                derivatives: string;
                manifest?: string;
            };
        };
        /** SourceAuthorizationResponse */
        "source-authorization-response.schema": {
            assetId: string;
            versionId: string;
            /** @enum {string} */
            authorizationMode: "signed-url" | "proxy-url" | "internal-handle";
            /** @enum {string} */
            resolvedOrigin: "source-export" | "source-proxy" | "lazy-read-cache";
            expiresAt: string;
            url: string;
        };
        /** DerivativeListResponse */
        "derivative-list-response.schema": {
            assetId: string;
            versionId: string;
            derivatives: {
                derivativeId: string;
                recipeId: string;
                variant: string;
                contentType: string;
                byteLength: number;
                deterministicKey: string;
                width?: number;
                height?: number;
            }[];
        };
        /** ImageAssetManifest */
        "image-asset-manifest.schema": {
            /** @constant */
            schemaVersion: "v1";
            /** @constant */
            manifestType: "image-default";
            assetId: string;
            versionId: string;
            serviceNamespaceId: string;
            /** Format: date-time */
            generatedAt: string;
            derivatives: {
                byteLength: number;
                checksum: string;
                contentType: string;
                deterministicKey: string;
                recipeId: string;
                schemaVersion: string;
                variantKey: string;
            }[];
        };
        /** PresentationAssetManifest */
        "presentation-asset-manifest.schema": {
            /** @constant */
            schemaVersion: "v1";
            /** @constant */
            manifestType: "presentation-default";
            assetId: string;
            versionId: string;
            serviceNamespaceId: string;
            /** Format: date-time */
            generatedAt: string;
            normalizedDocument: {
                byteLength: number;
                checksum: string;
                contentType: string;
                deterministicKey: string;
                recipeId: string;
                schemaVersion: string;
                /** @constant */
                variantKey: "normalized-pdf";
            };
            slides: {
                byteLength: number;
                checksum: string;
                contentType: string;
                deterministicKey: string;
                pageNumber: number;
                /** @constant */
                recipeId: "slide-images";
                schemaVersion: string;
                variantKey: string;
            }[];
        };
        /** DeliveryAuthorizationResponse */
        "delivery-authorization-response.schema": {
            assetId: string;
            versionId: string;
            deliveryScopeId: string;
            /** @enum {string} */
            authorizationMode: "public" | "signed-url" | "signed-cookie";
            /** @enum {string} */
            resolvedOrigin: "cdn-derived" | "origin-derived" | "manifest-bundle";
            expiresAt: string;
            url: string;
        };
    };
    responses: {
        /** @description RFC 9457 problem detail. */
        Problem: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "type": "https://docs.cdngine.dev/problems/version-not-ready",
                 *       "title": "Version not ready",
                 *       "status": 409,
                 *       "detail": "Requested derivatives are not yet published for this immutable version.",
                 *       "retryable": true,
                 *       "assetId": "ast_existing_123",
                 *       "versionId": "ver_01JQ9YG2PGM4H7QPQY5C8D6BBN"
                 *     }
                 */
                "application/problem+json": components["schemas"]["problem-detail.schema"];
            };
        };
    };
    parameters: {
        /** @description Stable caller-supplied key used to deduplicate mutating requests. */
        IdempotencyKey: string;
        /** @description Durable identifier for the staged upload session. */
        UploadSessionId: string;
        /** @description Stable logical asset identifier. */
        AssetId: string;
        /** @description Immutable asset-version identifier. */
        VersionId: string;
        /** @description Published manifest family for the version. */
        ManifestType: string;
        /** @description Delivery policy scope that resolves the public delivery posture. */
        DeliveryScopeId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    createUploadSession: {
        parameters: {
            query?: never;
            header: {
                /** @description Stable caller-supplied key used to deduplicate mutating requests. */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "serviceNamespaceId": "media-platform",
                 *       "tenantId": "tenant-acme",
                 *       "assetId": "ast_existing_123",
                 *       "assetOwner": "customer:acme",
                 *       "source": {
                 *         "filename": "hero-banner.png",
                 *         "contentType": "image/png"
                 *       },
                 *       "upload": {
                 *         "objectKey": "staging/media-platform/tenant-acme/upl_01JQ9YF8QJCPY9G7B8N1F3K6Z1",
                 *         "byteLength": 1843921,
                 *         "checksum": {
                 *           "algorithm": "sha256",
                 *           "value": "4d5f963e5e94932ea4b112fba6f2a5fd49af6e8ed179e67a0d4a4cc2c4f37df5"
                 *         }
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["upload-session-create-request.schema"];
            };
        };
        responses: {
            /** @description Upload session created or converged through idempotency. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "uploadSessionId": "upl_01JQ9YF8QJCPY9G7B8N1F3K6Z1",
                     *       "assetId": "ast_existing_123",
                     *       "versionId": "ver_01JQ9YG2PGM4H7QPQY5C8D6BBN",
                     *       "isDuplicate": false,
                     *       "uploadTarget": {
                     *         "protocol": "tus",
                     *         "method": "PATCH",
                     *         "url": "https://uploads.cdngine.local/files/upl_01JQ9YF8QJCPY9G7B8N1F3K6Z1",
                     *         "expiresAt": "2026-01-15T18:00:00Z"
                     *       },
                     *       "status": "awaiting-upload",
                     *       "links": {
                     *         "complete": "/v1/upload-sessions/upl_01JQ9YF8QJCPY9G7B8N1F3K6Z1/complete",
                     *         "version": "/v1/assets/ast_existing_123/versions/ver_01JQ9YG2PGM4H7QPQY5C8D6BBN"
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["upload-session-create-response.schema"];
                };
            };
            400: components["responses"]["Problem"];
            401: components["responses"]["Problem"];
            403: components["responses"]["Problem"];
            409: components["responses"]["Problem"];
            422: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
    completeUploadSession: {
        parameters: {
            query?: never;
            header: {
                /** @description Stable caller-supplied key used to deduplicate mutating requests. */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Durable identifier for the staged upload session. */
                uploadSessionId: components["parameters"]["UploadSessionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    stagedObject: {
                        objectKey: string;
                        byteLength: number;
                        checksum: {
                            /** @enum {string} */
                            algorithm: "sha256";
                            value: string;
                        };
                    };
                };
            };
        };
        responses: {
            /** @description Canonicalization accepted and workflow dispatch state exposed. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "uploadSessionId": "upl_01JQ9YF8QJCPY9G7B8N1F3K6Z1",
                     *       "assetId": "ast_existing_123",
                     *       "versionId": "ver_01JQ9YG2PGM4H7QPQY5C8D6BBN",
                     *       "versionState": "canonical",
                     *       "workflowDispatch": {
                     *         "dispatchId": "wd_01JQ9YPAQ5P1M1AR3JGY1X7A4W",
                     *         "state": "pending",
                     *         "workflowKey": "media-platform:ast_existing_123:ver_01JQ9YG2PGM4H7QPQY5C8D6BBN:image-derivation-v1"
                     *       },
                     *       "links": {
                     *         "version": "/v1/assets/ast_existing_123/versions/ver_01JQ9YG2PGM4H7QPQY5C8D6BBN"
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["upload-session-complete-response.schema"];
                };
            };
            401: components["responses"]["Problem"];
            403: components["responses"]["Problem"];
            409: components["responses"]["Problem"];
            410: components["responses"]["Problem"];
            422: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
    getAsset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Stable logical asset identifier. */
                assetId: components["parameters"]["AssetId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Logical asset resource. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "assetId": "ast_existing_123",
                     *       "serviceNamespaceId": "media-platform",
                     *       "tenantId": "tenant-acme",
                     *       "assetOwner": "customer:acme",
                     *       "latestVersion": {
                     *         "assetId": "ast_existing_123",
                     *         "versionId": "ver_01JQ9YG2PGM4H7QPQY5C8D6BBN",
                     *         "serviceNamespaceId": "media-platform",
                     *         "tenantId": "tenant-acme",
                     *         "assetOwner": "customer:acme",
                     *         "versionNumber": 3,
                     *         "lifecycleState": "processing",
                     *         "workflowState": "running",
                     *         "source": {
                     *           "contentType": "image/png",
                     *           "filename": "hero-banner.png",
                     *           "byteLength": 1843921
                     *         },
                     *         "links": {
                     *           "self": "/v1/assets/ast_existing_123/versions/ver_01JQ9YG2PGM4H7QPQY5C8D6BBN",
                     *           "derivatives": "/v1/assets/ast_existing_123/versions/ver_01JQ9YG2PGM4H7QPQY5C8D6BBN/derivatives"
                     *         }
                     *       },
                     *       "links": {
                     *         "self": "/v1/assets/ast_existing_123",
                     *         "latestVersion": "/v1/assets/ast_existing_123/versions/ver_01JQ9YG2PGM4H7QPQY5C8D6BBN"
                     *       }
                     *     }
                     */
                    "application/json": {
                        assetId: string;
                        serviceNamespaceId: string;
                        tenantId?: string | null;
                        assetOwner: string;
                        latestVersion: components["schemas"]["asset-version.schema"];
                        links: {
                            self: string;
                            latestVersion?: string;
                        };
                    };
                };
            };
            401: components["responses"]["Problem"];
            403: components["responses"]["Problem"];
            404: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
    getAssetVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Stable logical asset identifier. */
                assetId: components["parameters"]["AssetId"];
                /** @description Immutable asset-version identifier. */
                versionId: components["parameters"]["VersionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Immutable version resource. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "assetId": "ast_existing_123",
                     *       "versionId": "ver_01JQ9YG2PGM4H7QPQY5C8D6BBN",
                     *       "serviceNamespaceId": "media-platform",
                     *       "tenantId": "tenant-acme",
                     *       "assetOwner": "customer:acme",
                     *       "versionNumber": 3,
                     *       "lifecycleState": "published",
                     *       "workflowState": "completed",
                     *       "source": {
                     *         "contentType": "image/png",
                     *         "filename": "hero-banner.png",
                     *         "byteLength": 1843921
                     *       },
                     *       "links": {
                     *         "self": "/v1/assets/ast_existing_123/versions/ver_01JQ9YG2PGM4H7QPQY5C8D6BBN",
                     *         "derivatives": "/v1/assets/ast_existing_123/versions/ver_01JQ9YG2PGM4H7QPQY5C8D6BBN/derivatives",
                     *         "manifest": "/v1/assets/ast_existing_123/versions/ver_01JQ9YG2PGM4H7QPQY5C8D6BBN/manifests/image-default"
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["asset-version.schema"];
                };
            };
            401: components["responses"]["Problem"];
            403: components["responses"]["Problem"];
            404: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
    authorizeSourceDownload: {
        parameters: {
            query?: never;
            header: {
                /** @description Stable caller-supplied key used to deduplicate mutating requests. */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Stable logical asset identifier. */
                assetId: components["parameters"]["AssetId"];
                /** @description Immutable asset-version identifier. */
                versionId: components["parameters"]["VersionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    preferredDisposition?: "attachment" | "inline";
                };
            };
        };
        responses: {
            /** @description Authorized original-source read. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "assetId": "ast_existing_123",
                     *       "versionId": "ver_01JQ9YG2PGM4H7QPQY5C8D6BBN",
                     *       "authorizationMode": "signed-url",
                     *       "resolvedOrigin": "source-export",
                     *       "expiresAt": "2026-01-15T18:15:00Z",
                     *       "url": "https://downloads.cdngine.local/source/exp_01JQ9Z4SZ4SX2Y6V7G4W6J9P2V"
                     *     }
                     */
                    "application/json": components["schemas"]["source-authorization-response.schema"];
                };
            };
            401: components["responses"]["Problem"];
            403: components["responses"]["Problem"];
            404: components["responses"]["Problem"];
            409: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
    listDerivatives: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Stable logical asset identifier. */
                assetId: components["parameters"]["AssetId"];
                /** @description Immutable asset-version identifier. */
                versionId: components["parameters"]["VersionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deterministic derivative set. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "assetId": "ast_existing_123",
                     *       "versionId": "ver_01JQ9YG2PGM4H7QPQY5C8D6BBN",
                     *       "derivatives": [
                     *         {
                     *           "derivativeId": "drv_01JQ9ZHWR1PZK8A2NGW0BEM0DJ",
                     *           "recipeId": "image-default",
                     *           "variant": "webp-1600",
                     *           "contentType": "image/webp",
                     *           "byteLength": 512334,
                     *           "deterministicKey": "deriv/media-platform/ast_existing_123/ver_01JQ9YG2PGM4H7QPQY5C8D6BBN/image-default/webp-1600"
                     *         }
                     *       ]
                     *     }
                     */
                    "application/json": components["schemas"]["derivative-list-response.schema"];
                };
            };
            401: components["responses"]["Problem"];
            403: components["responses"]["Problem"];
            404: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
    getManifest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Stable logical asset identifier. */
                assetId: components["parameters"]["AssetId"];
                /** @description Immutable asset-version identifier. */
                versionId: components["parameters"]["VersionId"];
                /** @description Published manifest family for the version. */
                manifestType: components["parameters"]["ManifestType"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Published manifest payload. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["image-asset-manifest.schema"] | components["schemas"]["presentation-asset-manifest.schema"];
                };
            };
            401: components["responses"]["Problem"];
            403: components["responses"]["Problem"];
            404: components["responses"]["Problem"];
            409: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
    authorizeDelivery: {
        parameters: {
            query?: never;
            header: {
                /** @description Stable caller-supplied key used to deduplicate mutating requests. */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Stable logical asset identifier. */
                assetId: components["parameters"]["AssetId"];
                /** @description Immutable asset-version identifier. */
                versionId: components["parameters"]["VersionId"];
                /** @description Delivery policy scope that resolves the public delivery posture. */
                deliveryScopeId: components["parameters"]["DeliveryScopeId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    variant?: string;
                    /** @enum {string} */
                    responseFormat?: "url" | "cookie-bundle";
                };
            };
        };
        responses: {
            /** @description Authorized derivative delivery. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "assetId": "ast_existing_123",
                     *       "versionId": "ver_01JQ9YG2PGM4H7QPQY5C8D6BBN",
                     *       "deliveryScopeId": "public-images",
                     *       "authorizationMode": "signed-url",
                     *       "resolvedOrigin": "cdn-derived",
                     *       "expiresAt": "2026-01-15T18:30:00Z",
                     *       "url": "https://cdn.cdngine.local/i/public-images/ast_existing_123/ver_01JQ9YG2PGM4H7QPQY5C8D6BBN/webp-1600"
                     *     }
                     */
                    "application/json": components["schemas"]["delivery-authorization-response.schema"];
                };
            };
            401: components["responses"]["Problem"];
            403: components["responses"]["Problem"];
            404: components["responses"]["Problem"];
            409: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
}

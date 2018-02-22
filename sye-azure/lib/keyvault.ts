import KeyVaultManagementClient = require('azure-arm-keyvault')
import KeyVault = require('azure-keyvault')
import * as MsRest from 'ms-rest-azure'
import { AuthenticationContext, TokenResponse } from 'adal-node'
import * as dbg from 'debug'
import { getPrincipal, getSubscription } from './common'

// This is the objectId of an application, i.e. the objectId corresponding to the
// applicationId

const OBJECT_ID = ''
const ROOT_LOCATION = 'westus'

const debug = dbg('azure/cluster')

export async function createKeyVault(clusterId: string, credentials: any) {
    let principal = getPrincipal(clusterId)

    // Create keyvault
    let authenticator = function(challenge, callback) {
        // Create a new authentication context.
        let context = new AuthenticationContext(challenge.authorization)

        // Use the context to acquire an authentication token.
        return context.acquireTokenWithClientCredentials(
            challenge.resource,
            principal.appId,
            principal.password,
            function(err, resp) {
                if (resp.error) {
                    throw err
                } else {
                    // Calculate the value to be set in the request's Authorization header and resume the call.
                    const tokenResponse = resp as TokenResponse
                    var authorizationValue = tokenResponse.tokenType + ' ' + tokenResponse.accessToken
                    debug(authorizationValue)
                    return callback(null, authorizationValue)
                }
            }
        )
    }

    const subscription = await getSubscription(credentials, { resourceGroup: clusterId })
    let keyVaultManagementClient = new KeyVaultManagementClient(credentials, subscription.subscriptionId)

    let keyvault = await keyVaultManagementClient.vaults.createOrUpdate(clusterId, keyvaultName(clusterId), {
        location: ROOT_LOCATION,
        properties: {
            tenantId: principal.tenant,
            sku: {
                name: 'standard',
            },
            accessPolicies: [
                {
                    tenantId: principal.tenant,
                    objectId: OBJECT_ID,
                    permissions: {
                        keys: ['get', 'create', 'delete', 'list', 'update', 'import', 'backup', 'restore'],
                        secrets: ['all'],
                    },
                },
            ],
            enabledForDeployment: true,
        },
    })

    var kvCredentials = new MsRest.KeyVaultCredentials(authenticator, credentials)
    let keyVaultClient = new KeyVault.KeyVaultClient(kvCredentials)

    var attributes = { expires: new Date('2050-02-02T08:00:00.000Z'), notBefore: new Date('2016-01-01T08:00:00.000Z') }
    var keyOperations = ['encrypt', 'decrypt', 'sign', 'verify', 'wrapKey', 'unwrapKey']
    var keyOptions = {
        keyOps: keyOperations,
        keyAttributes: attributes,
    }
    var keyName = environmentKeyName(clusterId)
    keyName = keyName + ''
    await keyVaultClient.createKey(keyvault.properties.vaultUri, 'test', 'RSA', keyOptions)
}

export function keyvaultName(clusterId: string) {
    return `${clusterId}-keyvault`
}

export function environmentKeyName(clusterId: string) {
    return `${clusterId}-environment`
}

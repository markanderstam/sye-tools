import * as fs from 'fs'
import * as crypto from 'crypto'
import { exit, consoleLog } from '../../lib/common'
import * as MsRest from 'ms-rest-azure'
import { ResourceManagementClient, SubscriptionClient } from 'azure-arm-resource'
import { Subscription } from 'azure-arm-resource/lib/subscription/models'
const debug = require('debug')('azure/common')

export const SG_TYPE_DEFAULT = 'default'
export const SG_TYPE_SINGLE = 'single'
export const SG_TYPE_FRONTEND_BALANCER = 'fb'
export const SG_TYPE_FRONTEND_BALANCER_MGMT = 'fbmgmt'
export const SG_TYPE_MANAGEMENT = 'mgmt'
export const SG_TYPE_PITCHER = 'pitcher'

export const SG_TYPES = [
    SG_TYPE_DEFAULT,
    SG_TYPE_SINGLE,
    SG_TYPE_FRONTEND_BALANCER,
    SG_TYPE_FRONTEND_BALANCER_MGMT,
    SG_TYPE_MANAGEMENT,
    SG_TYPE_PITCHER,
]

class MyTokenCache {
    private tokens: any[] = []
    constructor(readonly profile: string) {
        this.load()
    }

    isSecureCache() {
        throw 'isSecureCache not implemented'
    }

    add(entries: any, cb: any) {
        this.tokens.push(...entries)
        cb()
    }

    remove(entries: any, cb: any) {
        this.tokens = this.tokens.filter((e) => {
            return !Object.keys(entries[0]).every((key) => e[key] === entries[0][key])
        })
        cb()
    }

    clear(cb: any) {
        this.tokens = []
        cb()
    }

    find(query, cb) {
        let result = this.tokens.filter((e) => {
            return Object.keys(query).every((key) => e[key] === query[key])
        })
        cb(null, result)
    }

    //
    // Methods specific to MyTokenCache
    //
    empty() {
        this.deleteOld()
        return this.tokens.length === 0
    }

    first() {
        return this.tokens[0]
    }

    private directoryName(): string {
        return `${process.env.HOME}/.sye`
    }

    private filename(): string {
        return `${this.directoryName()}/${this.profile}.tokens.json`
    }

    private load() {
        try {
            this.tokens = JSON.parse(fs.readFileSync(this.filename()).toString())
            this.tokens.map((t) => (t.expiresOn = new Date(t.expiresOn)))
        } catch (e) {}
    }

    save() {
        if (!fs.existsSync(this.directoryName())) {
            fs.mkdirSync(this.directoryName())
        }
        fs.writeFileSync(this.filename(), JSON.stringify(this.tokens))
    }

    delete() {
        if (fs.existsSync(this.filename())) {
            fs.unlinkSync(this.filename())
        }
    }

    private deleteOld() {
        this.tokens = this.tokens.filter((t) => t.expiresOn > Date.now() - 5 * 60 * 1000)
    }
}

let tokenCache: MyTokenCache

export function validateClusterId(clusterId: string) {
    if (!clusterId.match(/^[a-z0-9]{3,24}$/)) {
        exit(
            `Invalid cluster id ${clusterId}.\n` +
                'It must be 3 to 24 characters long and can only contain lowercase letters and numbers'
        )
    }
}

function matchSubscription(nameOrId: string, subscription: Subscription): boolean {
    if (subscription.displayName === nameOrId) {
        return true
    }
    if (subscription.subscriptionId === nameOrId) {
        return true
    }
    return false
}

export async function getSubscription(
    credentials: MsRest.DeviceTokenCredentials,
    filter: { subscription?: string; resourceGroup?: string } = {}
): Promise<Subscription> {
    filter.subscription = filter.subscription || process.env.AZURE_SUBSCRIPTION_ID
    const subscriptionClient = new SubscriptionClient(credentials)
    const subscriptionsFound: Subscription[] = []
    for (const subscription of await subscriptionClient.subscriptions.list()) {
        const resourceClient = new ResourceManagementClient(credentials, subscription.subscriptionId)
        if (filter.resourceGroup && !await resourceClient.resourceGroups.checkExistence(filter.resourceGroup)) {
            continue
        }
        if (filter.subscription && !matchSubscription(filter.subscription, subscription)) {
            continue
        }
        subscriptionsFound.push(subscription)
    }
    debug('Discovered subscriptions:', subscriptionsFound)
    switch (subscriptionsFound.length) {
        case 0:
            throw new Error(`Could not find any matching subscription`)
        case 1:
            return subscriptionsFound[0]
        default:
            throw new Error(
                `Cannot figure out which subscription to use: ${subscriptionsFound.map((s) => s.subscriptionId)}`
            )
    }
}

export async function getCredentials(profile = getProfileName()): Promise<MsRest.DeviceTokenCredentials> {
    if (!tokenCache) {
        tokenCache = new MyTokenCache(profile)
    }

    if (profile !== tokenCache.profile) {
        throw `profile mismatch: ${profile} !== ${tokenCache.profile}`
    }

    if (tokenCache.empty()) {
        let credentials = await MsRest.interactiveLogin({ tokenCache })
        consoleLog('Login successful')
        tokenCache.save()
        return credentials
    } else {
        let options: MsRest.DeviceTokenCredentialsOptions = {}
        let token = tokenCache.first()
        options.tokenCache = tokenCache
        options.username = token.userId

        let credentials = new MsRest.DeviceTokenCredentials(options)
        return credentials
    }
}

export function deleteCredentials(profile = getProfileName()): void {
    if (!tokenCache) {
        tokenCache = new MyTokenCache(profile)
    }
    tokenCache.delete()
}

export function getPrincipal(profile: string): { appId: string; tenant: string; password: string } {
    let principal = JSON.parse(fs.readFileSync(`${process.env.HOME}/.sye/${profile}.azure.json`).toString())
    return principal
}

export function getProfileName(): string {
    return process.env.AZURE_PROFILE || 'default'
}

// https://docs.microsoft.com/en-us/azure/architecture/best-practices/naming-conventions
export function vmName(machineName: string) {
    return machineName
}

export function nicName(machineName: string) {
    return `${machineName}-nic`
}

export function ipConfigName(machineName: string) {
    return `${machineName}-ipconfig`
}

export function publicIpName(machineName: string) {
    return `${machineName}-ip`
}

export function vnetName(region: string) {
    return `${region}-vnet`
}

export function subnetName(region: string) {
    return `${region}-subnet`
}

export function storageAccountName(subscriptionId: string, clusterId: string) {
    const MAX_STORAGE_ACCOUNT_NAME_LENGTH = 24
    const accountHash = crypto
        .createHash('md5')
        .update(subscriptionId)
        .digest('hex')
    return `${clusterId}${accountHash}`.substring(0, MAX_STORAGE_ACCOUNT_NAME_LENGTH) // Cannot contain dashes
}

export function publicContainerName() {
    return 'public'
}

export function privateContainerName() {
    return 'private'
}

export function dataDiskName(machineName: string) {
    return `${machineName}-data`
}

export function securityGroupName(clusterId: string, region: string, type: string) {
    return `${clusterId}-${region}-${type}-security-group`
}

export function getSecurityGroupType(securityGroupName: string) {
    return securityGroupName.split('-')[2]
}

export function securityRuleName(clusterId: string, region: string, groupType: string, type: string) {
    return `${clusterId}-${region}-${groupType}-${type}-security-group-rule`
}

import * as fs from 'fs'
import {exit} from '../../lib/common'
import * as MsRest from 'ms-rest-azure'

class MyTokenCache {
    private tokens: any[] = []
    constructor(readonly clusterId: string) {
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
            return !(Object.keys(entries[0]).every( key => e[key] === entries[0][key] ))
        })
        cb()
    }

    clear(cb: any) {
        this.tokens = []
        cb()
    }

    find(query, cb) {
        let result = this.tokens.filter((e) => {
            return Object.keys(query).every( key => e[key] === query[key] )
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
        return `${this.directoryName()}/${this.clusterId}.tokens.json`
    }

    private load() {
        try {
            this.tokens = JSON.parse(fs.readFileSync(this.filename()).toString())
            this.tokens.map(t => t.expiresOn = new Date(t.expiresOn))
        }
        catch (e) {}
    }

    save() {
        if (!fs.existsSync(this.directoryName())) {
            fs.mkdirSync(this.directoryName())
        }
        fs.writeFileSync(this.filename(), JSON.stringify(this.tokens))
    }

    private deleteOld() {
        this.tokens = this.tokens.filter( t => t.expiresOn > Date.now() - 5*60*1000)
    }

}

let tokenCache:MyTokenCache

export function validateClusterId(clusterId: string) {
    if(!clusterId.match(/^[a-z0-9]{3,24}$/)) {
        exit(`Invalid cluster id ${clusterId}.\n` +
        'It must be 3 to 24 characters long and can only contain lowercase letters and numbers')
    }
}

// Generate principal secret with
// az ad sp create-for-rbac --name something --password supersekret > ~/.sye/something.azure.json
export async function getCredentialsServicePrincipal(clusterId: string): Promise<MsRest.ApplicationTokenCredentials> {
    let principal = JSON.parse(fs.readFileSync(`${process.env.HOME}/.sye/${clusterId}.azure.json`).toString())
    return await MsRest.loginWithServicePrincipalSecret(
        principal.appId,
        principal.password,
        principal.tenant,
    )
}

export async function getCredentials(clusterId: string): Promise<MsRest.DeviceTokenCredentials> {
    if(!tokenCache) {
        tokenCache = new MyTokenCache(clusterId)
    }

    if( clusterId !== tokenCache.clusterId ) {
        throw `clusterId ${clusterId} !== ${tokenCache.clusterId}`
    }

    if(tokenCache.empty()) {
        let credentials = await MsRest.interactiveLogin({tokenCache})
        tokenCache.save()
        return credentials
    }
    else {
        let options: MsRest.DeviceTokenCredentialsOptions = {}
        let token = tokenCache.first()
        options.tokenCache = tokenCache
        options.username = token.userId

        let credentials = new MsRest.DeviceTokenCredentials(options)
        return credentials
    }
}

export function getPrincipal(clusterId: string): { appId: string, tenant: string, password: string } {
    let principal = JSON.parse(fs.readFileSync(`${process.env.HOME}/.sye/${clusterId}.azure.json`).toString())
    return principal
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

export function storageAccountName(clusterId: string) {
    return `${clusterId}` // Cannot contain dashes
}

export function publicContainerName() {
    return 'public'
}

export function privateContainerName() {
    return 'private'
}

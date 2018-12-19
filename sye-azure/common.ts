import * as crypto from 'crypto'
import { exit } from '../lib/common'

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

export function validateClusterId(clusterId: string) {
    if (!clusterId.match(/^[a-z0-9]{3,24}$/)) {
        exit(
            `Invalid cluster id ${clusterId}.\n` +
                'It must be 3 to 24 characters long and can only contain lowercase letters and numbers'
        )
    }
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

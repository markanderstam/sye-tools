import { isIPv6 } from 'net'
import DnsManagementClient from 'azure-arm-dns'
import * as dbg from 'debug'
import { getCredentials, getSubscription } from './common'

const debug = dbg('dns')

export function createDnsRecord(
    name: string,
    ip: string,
    ttl = 300,
    profile?: string,
    subscription?: string
): Promise<void> {
    return changeDnsRecord(name, ip, 'CREATE', profile, subscription, ttl)
}

export function deleteDnsRecord(name: string, ip: string, profile?: string, subscription?: string): Promise<void> {
    return changeDnsRecord(name, ip, 'DELETE', profile, subscription)
}

async function changeDnsRecord(
    name: string,
    ip: string,
    change: 'CREATE' | 'DELETE',
    profile?: string,
    subscription?: string,
    ttl?: number
): Promise<void> {
    const type = isIPv6(ip) ? 'AAAA' : 'A'
    const [, relativeRecordSetName, zone] = name.match(/(^.+?)\.(.+$)/)

    const credentials = await getCredentials(profile)
    const subscriptionId = (await getSubscription(credentials, { subscription })).subscriptionId
    const dnsClient = new DnsManagementClient(credentials, subscriptionId)

    const resource = (await dnsClient.zones.list()).find((z) => z.name === zone)
    if (!resource) {
        throw `Could not find any matching zone for ${zone}`
    }

    const [, resourceGroupName] = resource.id.match(/resourceGroups\/(.+?)\//)
    const records = await dnsClient.recordSets.listByDnsZone(resourceGroupName, zone)

    switch (change) {
        case 'CREATE':
            if (records.some((r) => r.name === relativeRecordSetName)) {
                throw `DNS record ${name} already exists`
            }
            const result = await dnsClient.recordSets.createOrUpdate(
                resourceGroupName,
                zone,
                relativeRecordSetName,
                type,
                {
                    tTL: ttl,
                    aRecords: type === 'A' ? [{ ipv4Address: ip }] : undefined,
                    aaaaRecords: type === 'AAAA' ? [{ ipv6Address: ip }] : undefined,
                }
            )
            debug('Created:', result)
            break
        case 'DELETE':
            if (
                !records.some(
                    (r) =>
                        r.name === relativeRecordSetName &&
                        (type === 'A'
                            ? r.aRecords.some((aR) => aR.ipv4Address === ip)
                            : r.aaaaRecords.some((aaaaR) => aaaaR.ipv6Address === ip))
                )
            ) {
                throw `Found no record ${name} with ip ${ip}`
            }
            await dnsClient.recordSets.deleteMethod(resourceGroupName, zone, relativeRecordSetName, type)
            break
    }
}

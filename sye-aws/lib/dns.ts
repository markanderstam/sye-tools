import { isIPv6 } from 'net'
import { Route53 } from 'aws-sdk'
import * as dbg from 'debug'

const debug = dbg('dns')

export function createDnsRecord(name: string, ip: string, ttl = 300, wait = false): Promise<void> {
    return changeDnsRecord(name, ip, ttl, wait, 'CREATE')
}

export function deleteDnsRecord(name: string, ip: string, ttl = 300, wait = false): Promise<void> {
    return changeDnsRecord(name, ip, ttl, wait, 'DELETE')
}

async function changeDnsRecord(
    name: string,
    ip: string,
    ttl: number,
    wait: boolean,
    changeAction: 'CREATE' | 'DELETE'
): Promise<void> {
    name += name.endsWith('.') ? '' : '.'

    const type = isIPv6(ip) ? 'AAAA' : 'A'
    const domain = name.replace(/^.+?\./, '')

    const route53 = new Route53()

    const hostedZones = await route53
        .listHostedZonesByName({
            DNSName: domain,
            MaxItems: '1',
        })
        .promise()
    if (hostedZones.HostedZones.length === 0) {
        throw `Found no hosted zone with name '${domain}'`
    }
    const hostedZoneId = hostedZones.HostedZones[0].Id

    debug(`${changeAction} resource: zone=${hostedZoneId}, name=${name}, ip=${ip}, type=${type}, ttl=${ttl}`)
    const resourceChange = await route53
        .changeResourceRecordSets({
            HostedZoneId: hostedZoneId,
            ChangeBatch: {
                Changes: [
                    {
                        Action: changeAction,
                        ResourceRecordSet: {
                            Name: name,
                            Type: type,
                            TTL: ttl,
                            ResourceRecords: [
                                {
                                    Value: ip,
                                },
                            ],
                        },
                    },
                ],
            },
        })
        .promise()

    if (wait) {
        const res = await route53.waitFor('resourceRecordSetsChanged', { Id: resourceChange.ChangeInfo.Id }).promise()
        if (res.ChangeInfo.Status !== 'INSYNC') {
            throw `Expected the DNS record change '${changeAction}' of '${name}' to be INSYNC, got ${res.ChangeInfo.Status}`
        }
    }
}

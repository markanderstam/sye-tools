import * as aws from 'aws-sdk'
import * as dbg from 'debug'
import * as EasyTable from 'easy-table'
import * as url from 'url'
import {consoleLog} from '../../lib/common'

const debug = dbg('cluster')

const services = [
    'ad-deduplicator',
    'ad-event-aggregator',
    'ad-impression-router',
    'ad-playlist-router',
    'ad-session-router',
    'ad-vast-reporter',
    'ad-vast-requester',
    'cluster-monitor',
    'etcd',
    'frontend',
    'frontend-balancer',
    'influxdb',
    'ingest',
    'kafka',
    'log',
    'login',
    'log-viewer',
    'machine-controller',
    'metric-viewer',
    'pitcher',
    'playout-controller',
    'playout-management',
    'release',
    'scaling',
    'schema-registry',
    'test',
    'video-source',
    'zookeeper'
]

function getRegistryUrl(repository: aws.ECR.Repository, prefix: string) {
    debug('getRegistryUrl')
    let match = repository.repositoryUri.match(new RegExp(`(.*)${prefix}`))
    if (match && match.length) {
        return `https://${match[0]}`
    } else {
        throw 'No ECR registry url found'
    }
}

function validateRegistryUrl(registryUrl: string) {
    debug('validateRegistryUrl')
    let u = url.parse(registryUrl)
    return u.hostname.match(/^\d+\.dkr\.ecr\.[a-zA-Z0-9-]+\.amazonaws\.com/)
        && u.pathname.match(/^\/[a-zA-Z0-9-]+$/)
}

function getRegionFromRegistryUrl(registryUrl: string) {
    debug('getRegionFromRegistryUrl')
    let match = registryUrl.match(/ecr.(.*).amazonaws/)
    if (validateRegistryUrl(registryUrl) && match && match.length > 0) {
        return match[1]
    } else {
        throw 'Invalid ECR registry url'
    }
}

function getPrefixFromRegistryUrl(registryUrl: string) {
    debug('getPrefixFromRegistryUrl')
    if (validateRegistryUrl(registryUrl)) {
        return url.parse(registryUrl).pathname.match(/[^\/][a-zA-Z0-9-]+$/)[0]
    } else {
        throw 'Invalid ECR registry url'
    }
}

export async function createRegistry(region: string, prefix = 'netinsight') {
    let ecr = new aws.ECR({ region })
    debug('createRepository')
    let repositories = await Promise.all(
        services.map((service) => ecr.createRepository({ repositoryName: `${prefix}/${service}` }).promise())
    )
    if (!repositories.length) {
        throw `No repositories created in ${region}`
    }
    consoleLog(`Registry url: ${getRegistryUrl(repositories[0].repository, prefix)}`)
}

export async function showRegistry(region: string, output = true, prefix = 'netinsight', raw = false) {
    let ecr = new aws.ECR({ region })
    let logOutput = ''
    let table = []
    let log = (msg: string) => logOutput += msg + '\n'

    debug('describeRepositories')
    let repositories = (await ecr.describeRepositories().promise()).repositories
        .filter((repo) => repo.repositoryName.match(new RegExp(`${prefix}/`)))
    if (!repositories.length) {
        throw `No repositories for ${prefix} found in ${region}`
    }
    let registryUrl = getRegistryUrl(repositories[0], prefix)
    logOutput = `Registry url: ${registryUrl}` + '\n'
    repositories.forEach((repo) => {
        debug('repository', repo.repositoryName)
        table.push({
            repositoryName: repo.repositoryName,
            repositoryUri: repo.repositoryUri,
            createdAt: repo.createdAt
        })
    })
    table.sort((r1, r2) => r1.repositoryName < r2.repositoryName ? -1 : 1)
    log(EasyTable.print(table))

    let repos = {}
    table.forEach((t) => {
        repos[t.repositoryName] = {
            repositoryUri: t.repositoryUri,
            createdAt: t.createdAt
        }
    })
    let registry = {
        url: registryUrl,
        repositories: repos
    }

    if (output) {
        if (raw) {
            consoleLog(JSON.stringify(registry, null, 2))
        } else {
            consoleLog(logOutput)
        }
    }
    return registry
}

export async function deleteRegistry(registryUrl: string) {
    let region = getRegionFromRegistryUrl(registryUrl)
    let ecr = new aws.ECR({ region })

    let repositories = (await showRegistry(
        region,
        false,
        getPrefixFromRegistryUrl(registryUrl),
        true)
    ).repositories
    for (let repositoryName of Object.keys(repositories)) {
        debug('listImages')
        let images = await ecr.listImages({ repositoryName }).promise()
        if (images.imageIds.length) {
            debug('batchDeleteImage')
            await ecr.batchDeleteImage({
                repositoryName: repositoryName,
                imageIds: images.imageIds
            }).promise()
        }
        debug('deleteRepository')
        await ecr.deleteRepository({ repositoryName }).promise()
    }
}

export async function grantPermissionRegistry(registryUrl: string, clusterId: string) {
    let region = getRegionFromRegistryUrl(registryUrl)
    let ecr = new aws.ECR({ region })
    let iam = new aws.IAM()

    debug('getInstanceProfile')
    let instanceProfile = await iam.getInstanceProfile({ InstanceProfileName: `${clusterId}-instance` }).promise()
    let role = instanceProfile.InstanceProfile.Roles.find((role) => role.RoleName.includes(`${clusterId}-instance`))
    if (!role) {
        throw `No role for instance of ${clusterId} cluster found`
    }

    for (let service of services) {
        let principal = []
        let repositoryName = `${getPrefixFromRegistryUrl(registryUrl)}/${service}`
        let repoPolicy = await ecr.getRepositoryPolicy({ repositoryName }).promise()
            .catch(() => debug(`No policy is set for repository ${repositoryName}`))

        if (repoPolicy) {
            let roleArns = JSON.parse(repoPolicy.policyText).Statement.find((s) => s.Sid === 'read-only').Principal.AWS
            if (typeof roleArns === 'string') {
                await iam.getRole({ RoleName: roleArns.match(/(?!role\/)([a-zA-Z0-9-.]+)$/)[0] }).promise()
                    .then(() => principal.push(roleArns))
                    .catch((e) => debug(`Failed to get role for ${roleArns} ${e.message}`))
            } else if (typeof roleArns === 'object') {
                for(let r of roleArns) {
                    await iam.getRole({ RoleName: r.match(/(?!role\/)([a-zA-Z0-9-.]+)$/)[0] }).promise()
                        .then(() => principal.push(r))
                        .catch((e) => debug(`Failed to get role for ${r} ${e.message}`))
                }
            }
            principal.push(role.Arn)
        } else {
            principal = [ role.Arn ]
        }

        debug('setRepositoryPolicy', repositoryName)
        await ecr.setRepositoryPolicy({
            repositoryName,
            policyText: JSON.stringify({
                Version: '2008-10-17',
                Statement: [
                    {
                        Sid: 'read-only',
                        Effect: 'Allow',
                        Principal: {
                            AWS: principal
                        },
                        Action: [
                            'ecr:GetDownloadUrlForLayer',
                            'ecr:BatchGetImage',
                            'ecr:BatchCheckLayerAvailability',
                            'ecr:ListImages'
                        ]
                    }
                ]
            })
        }).promise()
    }
}

import * as assert from 'assert'

export function cidrSubset6(cidr: string, subsetIndex: number) {
    let [address, length] = cidr.split('/')
    assert(parseInt(length) === 56)

    let num = ipv6Numeric(address)
    num[3] += subsetIndex
    return ipv6String(num) + '/64'
}

export function ipv6Numeric(address: string) {
    const b = [0, 0, 0, 0, 0, 0, 0, 0]

    const s = address.split('::')

    const s1 = s[0].split(':').map((s) => parseInt(s, 16))

    for (var n = 0; n < s1.length; n++) {
        if (s1[n]) {
            b[n] = s1[n]
        }
    }

    if (s.length === 2) {
        const s2 = s[1].split(':').map((s) => parseInt(s, 16))

        for (n = 0; n < s2.length; n++) {
            if (s2[n]) {
                b[8 - s2.length + n] = s2[n]
            }
        }
    }

    return b
}

export function ipv6String(address: number[]) {
    return address
        .map((n) => n.toString(16))
        .join(':')
        .replace(/(:0)+$/, '::')
}

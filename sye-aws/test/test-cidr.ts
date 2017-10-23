import * as test from 'purple-tape'
import * as cidr from '../lib/cidr'

test('address to number[]', function(t) {
    t.deepEqual(cidr.ipv6Numeric('::1'), [0,0,0,0,0,0,0,1], '::1')
    t.deepEqual(cidr.ipv6Numeric('1:2:3:4::'), [1, 2, 3, 4, 0, 0, 0, 0], '1:2:3:4::')
} )

test('number[] to address', function(t) {
    t.deepEqual(cidr.ipv6String([0, 0, 0, 0, 0, 0, 0, 1]), '0:0:0:0:0:0:0:1', '::1')
    t.deepEqual(cidr.ipv6String([1, 2, 3, 4, 0, 0, 0, 0]), '1:2:3:4::', '1:2:3:4::')
} )

test('cidrSubset6', function(t) {
    t.equal( cidr.cidrSubset6('1:2:3::/56', 1), '1:2:3:1::/64')
    t.equal( cidr.cidrSubset6('a001:b002::/56', 7), 'a001:b002:0:7::/64')
})

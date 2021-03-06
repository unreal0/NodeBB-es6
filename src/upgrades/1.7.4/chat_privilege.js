var groups = require('../../groups');

module.exports = {
	name: 'Give chat privilege to registered-users',
	timestamp: Date.UTC(2017, 11, 18),
	method: (callback) => {
		groups.join('cid:0:privileges:groups:chat', 'registered-users', callback);
	},
};

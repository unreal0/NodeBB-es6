var async = require('async');

var privileges = require('../../privileges');
var db = require('../../database');

module.exports = {
	name: 'Give vote privilege to registered-users on all categories',
	timestamp: Date.UTC(2018, 0, 9),
	method: (callback) => {
		db.getSortedSetRange('categories:cid', 0, -1, (err, cids) => {
			if (err) {
				return callback(err);
			}
			async.eachSeries(cids, (cid, next) => {
				privileges.categories.give(['posts:upvote', 'posts:downvote'], cid, 'registered-users', next);
			}, callback);
		});
	},
};

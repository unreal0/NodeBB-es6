

var async = require('async');

var db = require('../../database');
var user = require('../../user');

var sessionController = {};

sessionController.revoke = (req, res, next) => {
	if (!req.params.hasOwnProperty('uuid')) {
		return next();
	}

	var _id;
	var uid = res.locals.uid;
	async.waterfall([
		(next) => {
			if (!uid) {
				return next(new Error('[[error:no-session-found]]'));
			}
			db.getSortedSetRange('uid:' + uid + ':sessions', 0, -1, next);
		},
		(sids, done) => {
			async.eachSeries(sids, (sid, next) => {
				db.sessionStore.get(sid, (err, sessionObj) => {
					if (err) {
						return next(err);
					}
					if (sessionObj && sessionObj.meta && sessionObj.meta.uuid === req.params.uuid) {
						_id = sid;
						done();
					} else {
						next();
					}
				});
			}, next);
		},
		(next) => {
			if (!_id) {
				return next(new Error('[[error:no-session-found]]'));
			}

			user.auth.revokeSession(_id, uid, next);
		},
	], (err) => {
		if (err) {
			return res.status(500).send(err.message);
		}
		return res.sendStatus(200);
	});
};

module.exports = sessionController;

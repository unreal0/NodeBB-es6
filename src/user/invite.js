var async = require('async');
var nconf = require('nconf');
var validator = require('validator');

var db = require('./../database');
var meta = require('../meta');
var emailer = require('../emailer');
var translator = require('../translator');
var utils = require('../utils');

module.exports = (User) => {
	User.getInvites = (uid, callback) => {
		async.waterfall([
			(next) => {
				db.getSetMembers('invitation:uid:' + uid, next);
			},
			(emails, next) => {
				emails = emails.map(email =>
					validator.escape(String(email))
				);
				next(null, emails);
			},
		], callback);
	};

	User.getInvitesNumber = (uid, callback) => {
		db.setCount('invitation:uid:' + uid, callback);
	};

	User.getInvitingUsers = (callback) => {
		db.getSetMembers('invitation:uids', callback);
	};

	User.getAllInvites = (callback) => {
		var uids;
		async.waterfall([
			User.getInvitingUsers,
			(_uids, next) => {
				uids = _uids;
				async.map(uids, User.getInvites, next);
			},
			(invitations, next) => {
				invitations = invitations.map((invites, index) => ({
					uid: uids[index],
					invitations: invites,
				}));
				next(null, invitations);
			},
		], callback);
	};

	User.sendInvitationEmail = (uid, email, callback) => {
		callback = callback || function () {};

		var token = utils.generateUUID();
		var registerLink = nconf.get('url') + '/register?token=' + token + '&email=' + encodeURIComponent(email);

		var expireIn = (parseInt(meta.config.inviteExpiration, 10) || 1) * 86400000;

		async.waterfall([
			(next) => {
				User.getUidByEmail(email, next);
			},
			(exists, next) => {
				if (exists) {
					return next(new Error('[[error:email-taken]]'));
				}
				db.setAdd('invitation:uid:' + uid, email, next);
			},
			(next) => {
				db.setAdd('invitation:uids', uid, next);
			},
			(next) => {
				db.set('invitation:email:' + email, token, next);
			},
			(next) => {
				db.pexpireAt('invitation:email:' + email, Date.now() + expireIn, next);
			},
			(next) => {
				User.getUserField(uid, 'username', next);
			},
			(username, next) => {
				var title = meta.config.title || meta.config.browserTitle || 'NodeBB';
				translator.translate('[[email:invite, ' + title + ']]', meta.config.defaultLang, (subject) => {
					var data = {
						site_title: title,
						registerLink: registerLink,
						subject: subject,
						username: username,
						template: 'invitation',
					};

					// Append default data to this email payload
					data = Object.assign({}, emailer._defaultPayload, data);

					emailer.sendToEmail('invitation', email, meta.config.defaultLang, data, next);
				});
			},
		], callback);
	};

	User.verifyInvitation = (query, callback) => {
		if (!query.token || !query.email) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		async.waterfall([
			(next) => {
				db.get('invitation:email:' + query.email, next);
			},
			(token, next) => {
				if (!token || token !== query.token) {
					return next(new Error('[[error:invalid-token]]'));
				}

				next();
			},
		], callback);
	};

	User.deleteInvitation = (invitedBy, email, callback) => {
		callback = callback || function () {};
		async.waterfall([
			function getInvitedByUid(next) {
				User.getUidByUsername(invitedBy, next);
			},
			function deleteRegistries(invitedByUid, next) {
				if (!invitedByUid) {
					return next(new Error('[[error:invalid-username]]'));
				}
				async.parallel([
					(next) => {
						deleteFromReferenceList(invitedByUid, email, next);
					},
					(next) => {
						db.delete('invitation:email:' + email, next);
					},
				], (err) => {
					next(err);
				});
			},
		], callback);
	};

	User.deleteInvitationKey = (email, callback) => {
		callback = callback || function () {};

		async.waterfall([
			(next) => {
				User.getInvitingUsers(next);
			},
			(uids, next) => {
				async.each(uids, (uid, next) => {
					deleteFromReferenceList(uid, email, next);
				}, next);
			},
			(next) => {
				db.delete('invitation:email:' + email, next);
			},
		], callback);
	};

	function deleteFromReferenceList(uid, email, callback) {
		async.waterfall([
			(next) => {
				db.setRemove('invitation:uid:' + uid, email, next);
			},
			(next) => {
				db.setCount('invitation:uid:' + uid, next);
			},
			(count, next) => {
				if (count === 0) {
					return db.setRemove('invitation:uids', uid, next);
				}
				setImmediate(next);
			},
		], callback);
	}
};

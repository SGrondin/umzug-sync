'use strict'

var Umzug = require('umzug')
var Promise = require('bluebird')
var util = require('util')

function ExitEarly () { this.custom = true }
ExitEarly.prototype = Object.create(Error.prototype)
function ExitTimeout () { this.custom = true }
ExitTimeout.prototype = Object.create(Error.prototype)
function ExitError (message) { this.message = message; this.custom = true }
ExitError.prototype = Object.create(Error.prototype)

var mutexTableName = 'SequelizeMetaMutexes' // Intentionally hardcoded
var createMutexTable = function (sequelize) {
  var sql = util.format('CREATE TABLE IF NOT EXISTS "%s" ("mutex" INTEGER NOT NULL UNIQUE, "ts" TIMESTAMP WITHOUT TIME ZONE NOT NULL, "id" TEXT NOT NULL, PRIMARY KEY ("mutex"))', mutexTableName)
  return sequelize.query(sql)
}
var acquireLock = function (sequelize, SequelizeImport, lockTimeout) {
  return sequelize.transaction({
    isolationLevel: SequelizeImport.Transaction.ISOLATION_LEVELS.SERIALIZABLE
  }, function (t) {
    return sequelize.query(util.format('LOCK TABLE "%s" IN ACCESS EXCLUSIVE MODE NOWAIT', mutexTableName), { transaction: t })
    .then(function () {
      return sequelize.query(util.format('DELETE FROM "%s" WHERE "ts" < (NOW() - INTERVAL \'%d SECONDS\')', mutexTableName, lockTimeout), { transaction: t })
    })
    .then(function () {
      // Fully hardcoded, creates a collision on purpose
      return sequelize.query(util.format('INSERT INTO "%s" ("mutex", "ts", "id") VALUES (1, NOW(), MD5(NOW()::TEXT)) RETURNING *', mutexTableName), { transaction: t })
    })
    .spread(function (row) {
      return Promise.resolve(row.id)
    })
  })
}
var block = function (until, umzug, sequelize, SequelizeImport, lockTimeout) {
  return umzug.pending()
  .catch(function (err) {
    throw new ExitError(err.message)
  })
  .then(function (migrations) {
    if (migrations.length === 0) {
      throw new ExitEarly()
    }
    if (Date.now() >= until) {
      throw new ExitTimeout()
    }
    return acquireLock(sequelize, SequelizeImport, lockTimeout)
  })
  .catch(function (err) {
    if (err.custom) {
      return Promise.reject(err)
    }

    return Promise.delay(1500)
    .then(function () {
      return block(until, umzug, sequelize, SequelizeImport, lockTimeout)
    })
  })
}
var releaseLock = function (sequelize, id) {
  return sequelize.query(util.format('DELETE FROM "%s" WHERE "id" = \'%s\'', mutexTableName, id))
}

exports.migrate = function (params) {
  var shutdown = false
  var signalHandler = function (signal) {
    shutdown = true
  }
  process.on('SIGINT', signalHandler)
  process.on('SIGTERM', signalHandler)
  process.on('SIGHUP', signalHandler)

  var lockTimeout = (Number.isInteger(params.timeout) && params.timeout > 0) ? params.timeout : 15
  var systemTimeout = lockTimeout * 2
  var config = {
    storage: 'sequelize',
    storageOptions: {
      sequelize: params.sequelize
    },
    logging: params.logging == null ? false : params.logging,
    migrations: {
      params: [ params.sequelize.getQueryInterface(), params.SequelizeImport ],
      path: params.migrationsDir,
      pattern: /.+\.js$/ // or else migration(s) with period(s) in their name doesn't work
    }
  }
  var cwd = process.cwd()
  if (params.chdir) {
    process.chdir(params.chdir)
  }
  var cleanup = function () {
    if (params.chdir) {
      process.chdir(cwd)
    }
    process.removeListener('SIGINT', signalHandler)
    process.removeListener('SIGTERM', signalHandler)
    process.removeListener('SIGHUP', signalHandler)
  }
  var umzug = new Umzug(config)

  var mutex = ''
  return params.sequelize.authenticate()
  .then(function () {
    return createMutexTable(params.sequelize)
  })
  .then(function () {
    var until = Date.now() + (systemTimeout * 1000)
    return block(until, umzug, params.sequelize, params.SequelizeImport, lockTimeout)
  })
  .then(function (id) {
    mutex = id
    return umzug.up()
  })
  .then(function () {
    cleanup()
    return releaseLock(params.sequelize, mutex)
  })
  .catch(ExitEarly, function () {
    return Promise.resolve()
  })
  .then(function () {
    cleanup()
    return Promise.resolve()
  })
  .catch(ExitTimeout, function () {
    return Promise.reject(new Error('Could not execute the migrations within ' + systemTimeout + ' seconds (2 * timeout).'))
  })
  .catch(function (err) {
    cleanup()
    return Promise.reject(err)
  })
}

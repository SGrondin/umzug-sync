# umzug-sync

Sequelize (Postgresql only) migrations for distributed systems. This library uses `umzug`, the library used by Sequelize to run migrations. Usually those migrations are run from the command line tool, `sequelize-cli`. This library makes it easy and safe to run migrations from the application code across a cluster of servers. All servers can call `usync.migrate()` and wait on the promise and be guaranteed upon resolution that the database schema is fully up to date.

Umzug-sync is resilient against race conditions, conflicts, concurrent migrations, timeouts and many other issues that may occur in distributed environments.

```js
var usync = require('umzug-sync')
var Sequelize = require('sequelize')
var sequelize = new Sequelize({ /* sequelize options */ })

var config = {
  sequelize: sequelize,
  SequelizeImport: Sequelize,
  migrationsDir: 'migrations/'
}

usync.migrate(config)
.then(function () {
  // Execute program
})
.catch(function (err) {
  // Handle the error, something bad happened
})
```

There is only one function: `migrate()`. It takes a `config` object and returns a promise.

### config

The config object supports the following options:

| Name | Type | Mandatory | Default | Description |
|------|------|-----------|---------|-------------|
| `sequelize` | Object | Yes | | A configured instance of `Sequelize`. |
| `SequelizeImport` | Object | Yes | | The Sequelize library object that created the `sequelize` instance. |
| `migrationsDir` | String | Yes | | Path (relative or absolute) where the migration files are located. Those files must end in `.js`. |
| `chdir` | String | No | | Sometimes migration files load other files relatively to a certain assumed Current Working Directory (cwd/pwd). Setting this option to a path will change the cwd/pwd of the process for the duration of the `migrate()` function execution and change it back afterwards. |
| `logging` | Function | No | | Function that will be called with a single `string` argument whenever a migration event occurs. Example value: `console.log` |
| `timeout` | Integer | No | 15 | Maximum time (in seconds) to wait for the mutex. `migrate()` is guaranteed to resolve/reject within `2 * timeout` |

### **WARNING**

Race conditions are possible if the `timeout` expires **before** the migrations are done executing. This is **by design** in case a migration gets "jammed" or the server simply disappears mid-migration(s). This way another server will get a chance to run the migrations instead of leaving the whole system in a broken state. So pick the `timeout` value carefully.

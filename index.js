const express = require('express')
const cors = require('cors');
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
console.log(process.env)
const admin = require("firebase-admin");
const crypto = require('crypto');

const serviceAccount = require(process.env.SERVICE);
const stripe = require('stripe')(process.env.STRIPE_SECRET);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// middleware
app.use(express.json());
app.use(cors());

function generateTransactionId() {
  return 'txn_' + crypto.randomBytes(8).toString('hex');
}

const verifyJWT = async (req, res, next) => {
  console.log('headers in middleware', req.headers.authorization)
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log('decoded in the token', decoded);
    req.decoded_email = decoded.email
    next()
  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

  // next()
}


const port = process.env.PORT || 3000
// const uri = "mongodb+srv://club_sphere:WhfYjPP03mMksieb@cluster0.j9qjn8n.mongodb.net/?appName=Cluster0";
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.j9qjn8n.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const db = client.db('club_server')

    const clubCollections = db.collection('clubs')
    const userCollections = db.collection('users')
    const eventCollections = db.collection('events')
    const membershipCollections = db.collection('membership')
    const eventRegistrationCollections = db.collection('eventRegistration')
    const paymentCollections = db.collection('payments')

    app.post('/clubs', async (req, res) => {
      const club = req.body;
      const result = await clubCollections.insertOne(club);
      res.send(result);
    })

    app.get('/clubs', async (req, res) => {
      const { status, email, search, sortedKey, sortedValue } = req.query;
      const query = {}

      if (search) {
        // query.clubName = { $regex: search, $options: 'i' }

        query.$or = [
          { clubName: { $regex: search, $options: 'i' } },
        ]

      }

      if (email) {
        query.managerEmail = email
      }
      if (status) {
        query.status = status;
      }

      if (sortedKey || sortedValue) {
        const cursor = clubCollections.find(query).sort({ [sortedKey]: Number(sortedValue) })
        const result = await cursor.toArray();
        res.send(result);
      }

      else {
        const cursor = clubCollections.find(query)
        const result = await cursor.toArray();
        res.send(result);
      }


      // console.log('headers', req.headers);



    })

    app.get('/member-clubs', async (req, res) => {
      const queryEmail = {}
      const { userEmail } = req.query;
      if (userEmail) {
        queryEmail.userEmail = userEmail
      }
      const memberships = await membershipCollections.find(queryEmail).toArray();
      const clubIds = memberships.map(member => new ObjectId(member.clubId));

      const totalClubs = await clubCollections.find({
        _id: { $in: clubIds }
      }).toArray();

      console.log(memberships)
      const mergedClubs = totalClubs.map(club => {
        const membership = memberships.find(
          m => m.clubId === club._id.toString()
        );

        club.membershipStatus = membership?.status
        return club
      });

      res.send(mergedClubs);
    })

    app.get('/clubs/:id', async (req, res) => {
      const id = req.params.id
      console.log(id)
      const query = { _id: new ObjectId(id) }


      const result = await clubCollections.findOne(query);

      res.send(result);
    })

    app.patch('/clubs/:id', async (req, res) => {
      const { id } = req.params
      const clubData = req.body
      const query = { _id: new ObjectId(id) };

      const updatedDoc = {
        $set: clubData
      }

      const result = await clubCollections.updateOne(query, updatedDoc);
      res.send(result);
    })

    app.delete('/clubs/:id', async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };

      const result = await clubCollections.deleteOne(query);
      res.send(result);
    })

    // Event apis
    app.post('/events', async (req, res) => {
      const eventData = req.body;
      // eventData.clubId = generateClubId();
      const result = await eventCollections.insertOne(eventData);
      res.send(result);
    })

    app.get('/events', async (req, res) => {
      const query = {}

      const cursor = eventCollections.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/events/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await eventCollections.findOne(query);
      res.send(result);
    })

    app.get('/upcoming-events', async (req, res) => {
      const { email } = req.query;
      const emailQuery = { userEmail: email }
      const members = await membershipCollections.find(emailQuery).toArray();

      const data = await Promise.all(
        members.map(async member => {
          const eventsCount = await eventCollections.find({
            clubId: member.clubId.toString()
          }).toArray()

          return eventsCount
        })
      );

      const flatEvents = data.flat()
      res.send(flatEvents);
    })

    app.get('/member-events', async (req, res) => {
      const queryEmail = {}
      const { userEmail } = req.query;
      if (userEmail) {
        queryEmail.userEmail = userEmail
      }
      const registrations = await eventRegistrationCollections.find(queryEmail).toArray();
      const eventIds = registrations.map(reg => new ObjectId(reg.eventId));
      console.log(registrations, eventIds)
      const totalEvents = await eventCollections.find({
        _id: { $in: eventIds }
      }).toArray();

      const clubIds = totalEvents.map(event => new ObjectId(event.clubId));
      const clubs = await clubCollections.find({
        _id: { $in: clubIds }
      }).toArray()

      const mergedEvents = totalEvents.map(event => {
        const registration = registrations.find(
          m => m.eventId === event._id.toString()
        );

        const club = clubs.find(c => c._id.toString() === event.clubId)

        event.registrationStatus = registration?.status
        event.clubName = club?.clubName
        return event
      });

      res.send(mergedEvents);
    })

    app.patch('/events/:id', async (req, res) => {
      const { id } = req.params;
      const eventInfo = req.body
      const query = { _id: new ObjectId(id) };

      const updatedDoc = {
        $set: eventInfo
      }

      const result = await eventCollections.updateOne(query, updatedDoc);
      res.send(result)
    })

    app.delete('/events/:id', async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await eventCollections.deleteOne(query);
      res.send(result);
    })

    // users apis

    app.post('/users', async (req, res) => {
      const userInfo = req.body;
      userInfo.role = 'member';
      userInfo.createdAt = new Date();

      const userExist = await userCollections.findOne({ email: userInfo.email })
      if (userExist) {
        return res.send({ message: 'user already exists' })
      }

      const result = await userCollections.insertOne(userInfo);
      res.send(result)
    })

    app.get('/users', async (req, res) => {
      const query = {}
      const cursor = userCollections.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/users/:email/role', async (req, res) => {
      const { email } = req.params
      const query = { email: email }
      const user = await userCollections.findOne(query);
      res.send({ role: user?.role })
    })

    app.patch('/users/:id', async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) }
      const role = req.body
      console.log(id, role)
      const updatedDoc = {
        $set: role
      };
      const result = await userCollections.updateOne(query, updatedDoc);
      res.send(result);
    })


    // eventRegistration apis
    app.get('/eventRegistrations', async (req, res) => {
      const { eventId, email } = req.query;
      const query = {};
      if (eventId) {
        query.eventId = eventId
      }
      if (email) {
        query.userEmail = email
      }
      const result = await eventRegistrationCollections.findOne(query);
      res.send(result);
    })

    app.get('/allEventRegistrations', async (req, res) => {
      const { userEmail } = req.query
      const query = {}

      if (userEmail) {
        query.userEmail = userEmail
      }

      const cursor = eventRegistrationCollections.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/event-registrations', async (req, res) => {
      const { eventId, email } = req.query;
      const query = {};
      if (eventId) {
        query.eventId = eventId
        const result = await eventRegistrationCollections.find(query).toArray();
        res.send(result);
      }

      else {
        res.send([])
      }

    })

    app.post('/eventRegistrations', async (req, res) => {
      const eventRegistrationInfo = req.body;
      console.log(eventRegistrationInfo);
      const alreadyExisting = await eventRegistrationCollections.findOne({
        userEmail: eventRegistrationInfo.userEmail,
        eventId: eventRegistrationInfo.eventId
      });
      console.log(alreadyExisting);
      if (alreadyExisting) {
        return res.send({ message: 'already exists' });
      }
      const result = await eventRegistrationCollections.insertOne(eventRegistrationInfo);
      res.send(result);
    })


    // membership apis
    app.get('/membership', async (req, res) => {
      const { email, clubId } = req.query;
      const query = {};
      if (email) {
        query.userEmail = email
      }
      if (clubId) {
        query.clubId = clubId
      }
      const result = await membershipCollections.findOne(query);
      res.send(result);
    })

    app.get('/members', async (req, res) => {
      const query = {}
      const { userEmail } = req.query;

      if (userEmail) {
        query.userEmail = userEmail
      }
      const cursor = membershipCollections.find(query)
      const result = await cursor.toArray();
      res.send(result);
    })



    app.get('/membership/:id', async (req, res) => {
      const { id } = req.params;
      const query = { clubId: id };
      const cursor = membershipCollections.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.patch('/membership/:id', async (req, res) => {
      const { id } = req.params;
      const status = req.body;
      console.log(status);
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: status
      }
      const result = await membershipCollections.updateOne(query, updatedDoc);
      res.send(result);
    })

    app.post('/membership', async (req, res) => {
      const membershipInfo = req.body;
      const query = { userEmail: membershipInfo.userEmail, clubId: membershipInfo.clubId };
      const existingMembership = await membershipCollections.findOne(query);
      if (existingMembership) {
        return res.send({ message: 'already exists' })
      }

      const result = await membershipCollections.insertOne(membershipInfo);
      res.send(result);
    })

    app.get('/club-members', async (req, res) => {
      // const data = [];
      // const clubs = await clubCollections.find().toArray();
      // clubs.map(club => {
      //   const query = {clubId: club._id.toString()};
      //   const membershipCount = membershipCollections.countDocuments(query);
      //   data.push({
      //     name: club.clubName,
      //     membership: membershipCount
      //   })
      // })

      // res.send(data);

      const clubs = await clubCollections.find().toArray();

      const data = await Promise.all(
        clubs.map(async club => {
          const membershipCount = await membershipCollections.countDocuments({
            clubId: club._id.toString()
          });

          return {
            name: club.clubName,
            membership: membershipCount
          }
        })
      );

      res.send(data);
    })

    app.get('/total-members', async (req, res) => {
      const { email } = req.query;
      const query = {};
      if (email) {
        query.managerEmail = email
      }

      const managerClubs = await clubCollections.find(query).toArray();
      const clubIds = managerClubs.map(c => c._id.toString());
      console.log(clubIds)
      const totalMembers = await membershipCollections.find({
        clubId: { $in: clubIds }
      }).toArray();

      res.send(totalMembers);

    })

    app.get('/total-events', async (req, res) => {
      const { email } = req.query;
      const query = {};
      if (email) {
        query.managerEmail = email
      }

      const managerClubs = await clubCollections.find(query).toArray();
      const clubIds = managerClubs.map(c => c._id.toString());
      const totalEvents = await eventCollections.find({
        clubId: { $in: clubIds }
      }).toArray();

      res.send(totalEvents);
    })

    app.get('/created-event-registrations', async (req, res) => {
      const { email } = req.query;
      const query = {};
      if (email) {
        query.managerEmail = email
      }

      const managerClubs = await clubCollections.find(query).toArray();
      const clubIds = managerClubs.map(c => c._id.toString());
      const totalEventRegistrations = await eventRegistrationCollections.find({
        clubId: { $in: clubIds }
      }).toArray();

      res.send(totalEventRegistrations)
    })

    // payment apis
    app.get('/payments', async (req, res) => {
      const query = {}
      const { userEmail } = req.query;

      if (userEmail) {
        query.userEmail = userEmail
      }
      console.log(userEmail)
      const cursor = paymentCollections.find(query);
      const result = await cursor.toArray();
      res.send(result)
    })


    // stripe apis
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.amount) * 100
      paymentInfo.transactionId = generateTransactionId();
      paymentInfo.createdAt = new Date()

      // dynamic metadata
      const metadata = {};

      if (paymentInfo.clubId) {
        metadata.clubId = paymentInfo.clubId,
          metadata.name = paymentInfo.name
      }

      if (paymentInfo.eventId) {
        metadata.eventId = paymentInfo.eventId,
          metadata.name = paymentInfo.name
      }

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: { name: paymentInfo.name }
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.email,
        mode: 'payment',
        metadata,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      console.log(session)
      res.send({ url: session.url })
    });

    app.patch('/payment-success', async (req, res) => {
      const sessionid = req.query.session_id

      const session = await stripe.checkout.sessions.retrieve(sessionid);
      // console.log(session)
      const paymentId = session.payment_intent;
      const query = { paymentId: paymentId }

      const membershipExist = await membershipCollections.findOne(query)
      const eventRegistrationExist = await eventRegistrationCollections.findOne(query)
      console.log(query, membershipExist, eventRegistrationExist)
      if (membershipExist || eventRegistrationExist) {
        return res.send({ message: 'already exists' })
      }
      console.log(session);
      if (session.payment_status === 'paid') {

        if (session.metadata.eventId) {
          await eventRegistrationCollections.insertOne({
            userEmail: session.customer_email,
            clubId: session.metadata.clubId,
            eventId: session.metadata.eventId,
            status: "registered",
            paymentId: session.payment_intent,
            amount: session.amount_total / 100,
            registeredAt: new Date()
          })

          await paymentCollections.insertOne({
            userEmail: session.customer_email,
            amount: session.amount_total / 100,
            type: 'event',
            name: session.metadata.name,
            createdAt: new Date()
          })
        }
        else {
          await membershipCollections.insertOne({
            userEmail: session.customer_email,
            clubId: session.metadata.clubId,
            status: "active",
            paymentId: session.payment_intent,
            amount: session.amount_total / 100,
            joinedAt: new Date()
          })

          await paymentCollections.insertOne({
            userEmail: session.customer_email,
            amount: session.amount_total / 100,
            type: 'membership',
            name: session.metadata.name,
            createdAt: new Date()
          })
        }
      }

      res.send({ success: true })
    })


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
    // console.log(process.env.DB_USER, process.env.DB_PASS)
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Club sphere is rolling')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

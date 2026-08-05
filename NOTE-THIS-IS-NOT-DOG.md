# This branch is not part of Dog Park 3D

It is **Smallmouth** — a separate game, parked here only because this session
could not create `Pappydapimp69/smallmouth` (the integration returned 403 on
repository creation) and the build container is ephemeral.

Nothing on this branch is referenced by, or reachable from, any Dog branch.

To move it to its own repo:

```sh
gh repo create Pappydapimp69/smallmouth --private
git clone <this-repo> tmp && cd tmp
git checkout smallmouth-milestone-1
git remote add sm https://github.com/Pappydapimp69/smallmouth
git push sm smallmouth-milestone-1:main
```

Then delete this branch: `git push origin --delete smallmouth-milestone-1`

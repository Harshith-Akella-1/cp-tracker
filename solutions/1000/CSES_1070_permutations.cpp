// Permutations (CSES, rating 1000)
// https://cses.fi/problemset/task/1070
// Accepted 26/10/2026

#include <bits/stdc++.h>
using namespace std;

int main(){

    int n;
    cin >> n;

    if(2<=n && n<=3) {
        cout << "NO SOLUTION" << endl;
        return 0;
    }

    for(int i=2; i<=n;i+=2) cout << i << " ";

    for(int i=1;i<=n;i+=2) cout << i << " ";

    


    return 0;
}
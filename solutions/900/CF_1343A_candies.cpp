// Candies (Codeforces, rating 900)
// https://codeforces.com/problemset/problem/1343/A
// Accepted 23/10/2026

#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int t;
    cin >> t;

    while(t--){
        long long n;
        cin >> n;

        long long divsor = pow(2, 2)-1;
        long long x=n/divsor;

        while(n>=divsor){
            if(n%divsor==0){
                x=n/divsor;
                break;
            }
            
            divsor=2*divsor+1;

        }

        cout << x << endl;

    }



    return 0;
}
